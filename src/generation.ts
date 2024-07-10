import * as vscode from 'vscode';
import { FieldFull } from './golang-parser/types';
import { FIELD_TAG_LINE, FIELD_TYPE_STRUCT_Array_START, FIELD_TYPE_STRUCT_Array_START_2, FIELD_TYPE_STRUCT_END, FIELD_TYPE_STRUCT_START, FIELD_TYPE_STRUCT_START_2 } from './constants';
// import * as path from 'path';
// import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import * as fs from 'fs';


export async function executeGenerateCommand(
  textEditor: vscode.TextEditor,
  edit: vscode.TextEditorEdit,
  noBackets: boolean = false
) {
  const document = textEditor.document;
  for (let selection of textEditor.selections) {
    const start = selection.start.line;
    const end = selection.end.line;
    try {
      const struct = getFields(start, end, document);
      let result = await generate(struct, noBackets);
      vscode.env.clipboard.writeText(result);
      vscode.window.showInformationMessage("生成的JSON内容已复制至粘贴板：\n" + result);
    } catch (err: any) {
      vscode.window.showErrorMessage(`${err.toString()} (line ${start + 1})`);
    }
    break;
  }
}


function getFields(
  start: number,
  end: number,
  document: vscode.TextDocument,
): FieldFull[] {
  let scope: { start: number; end: number };
  try {
    scope = getStructScope(start, document);
  } catch (err) {
    if (start === end) { throw err; }
    scope = getStructScope(end, document);
  }

  if (scope.start > scope.end) {
    throw new Error(`invalid struct format (${document.fileName} : ${start}-${end} | found struct scope: ${scope.start}-${scope.end})`);
  }

  if (scope.start + 1 > scope.end - 1) {
    return [];
  }

  let res: number[] = [];
  for (let line = scope.start + 1; line <= scope.end - 1; line++) {
    res.push(line);
  }

  let fields: FieldFull[] = [];
  fields = res.map((line) => {
    const text = document.lineAt(line).text;
    // const field = /^\s*(([\w]+)\s)?\s*([\*\[\]\.\w\{\}]+)/;
    const fieldMulti = /^\s*([\w]+(\s*,\s*[\w]+)*\s)?\s*([\*\[\]\.\w\{\}]+)/;
    const tag = /^[^\/]*`.*json:"(\-,)?([^,"]*).*"/;
    // const fs = field.exec(text);
    const fsMult = fieldMulti.exec(text);
    const tagJson = tag.exec(text);
    const tg = tagJson ? tagJson[1] ? tagJson[1] : tagJson[2] : '';
    let pos: vscode.Position = new vscode.Position(line, 0);
    if (fsMult) {
      let idx = text.indexOf(fsMult[3]);
      pos = new vscode.Position(line, idx);
      let nameArr = fsMult[1] ? fsMult[1].split(',').map((name) => name.trim()).filter((name) => name !== '' && /^[A-Z]/.test(name)) : null;
      return {
        names: nameArr, //null 表示隐藏内嵌字段 或者 } 结尾
        type: fsMult[3],
        tagJson: tg,
        typePosition: pos,
        document: document
      };
    }
    //  else if (fs) {
    //   let idx = text.indexOf(fs[3]);
    //   pos = new vscode.Position(line, idx);
    //   return {
    //     names: fs[2] ? [fs[2]] : [],
    //     type: fs[3],
    //     tagJson: tg,
    //     typePosition: pos,
    //     document: document
    //   };
    // }
    return null;
  }).filter((field): field is FieldFull => {
    if (field === null) {
      return false;
    }
    if (field.tagJson === '-' && field.type !== FIELD_TYPE_STRUCT_END) {
      return false;
    }
    if (field.tagJson !== '') {
      if (field.names) {
        if (field.names.length > 1) {
          return false; //公开字段名 大于 1 个，又指定了 json tag。则都不序列化。（go json.Marshal 的逻辑）
        }
      }
    }
    if (field.names !== null) {
      if (field.names.length === 0 && !isInerStructStart(field)) {
        return false; //公开字段名 为 0 个，并且不是内嵌结构start，过滤掉
      }
    }
    if (field.names === null && field.type !== FIELD_TYPE_STRUCT_END) {
      //隐藏字段
      if (getKeyStrByType(field.type, field.tagJson) === '') {
        return false; // 私有的 隐藏字段，过滤掉
      }
    }
    return true;
  });

  return fields;
}

function getStructScope(
  line: number,
  document: vscode.TextDocument,
): { start: number; end: number } {

  const typesStartRec = /^\s*type\s*\(\s*/;
  const typesEndRec = /^\s*\)\s*/;
  const typeRecSingle = /^\s*type\s+\w+\s+struct\s*\{/;
  const typeRecSingleEmpty = /^\s*type\s+\w+\s+struct\s*\{\s*\}/;
  const typeRecInBackets = /^\s*\w+(\s*,\s*\w+)*\s+[^\/\s]*\]?\*?struct\s*\{/;
  const typeRecInBacketsEmpty = /^\s*\w+(\s*,\s*\w+)*\s+[^\/\s]*\]?\*?struct\s*\{\s*\}/;
  const typeTail = /^\s*}/;

  let headLine = -1;
  let tailLine = -1;
  let backetStartLine = -1;

  // 向上找定义开始行
  for (let l = line; l >= 0; l--) {
    const currentLine = document.lineAt(l).text;
    if (typeRecSingleEmpty.exec(currentLine)) {
      // 空struct定义
      headLine = l;
      tailLine = l;
      break;
    } else if (typeRecSingle.exec(currentLine)) {
      headLine = l;
      break;
    }
    if (typesStartRec.exec(currentLine)) {
      backetStartLine = l;
      break;
    }
  }

  if (headLine === tailLine && headLine !== -1) {
    //空struct
    if (line !== headLine) {
      throw new Error(`不是 struct (${document.fileName} : ${line + 1})`);
    }
    return { start: headLine, end: headLine };
  }

  if (headLine === -1 && backetStartLine === -1) {
    throw new Error(`不是 struct (${document.fileName} : ${line + 1})`);
  }

  // 在独立 type struct {} 定义中找到 定义 结束行
  if (headLine > -1) {
    let headCounts = 1;
    let tailCounts = 0;
    for (let l = headLine; l < document.lineCount; l++) {
      const currentLine = document.lineAt(l).text;
      if (typeRecInBacketsEmpty.exec(currentLine)) {
        // headCounts++;
      } else if (typeRecInBackets.exec(currentLine)) {
        headCounts++;
      } else if (typeTail.exec(currentLine)) {
        tailCounts++;
      }

      if (headCounts === tailCounts) {
        tailLine = l;
        break;
      }
    }


    if (tailLine === -1 || tailLine < line) {
      throw new Error(`不是 struct (${document.fileName} : ${line + 1})`);
    }

  }

  // 在 type ( ) 中找到结构体定义开始 及 结束行
  if (backetStartLine > -1) {
    let headCounts = 0;
    let tailCounts = 0;
    let pass = false;
    let head = -1;
    for (let l = backetStartLine; l < document.lineCount; l++) {
      const currentLine = document.lineAt(l).text;
      if (l >= line) {
        pass = true;
      }
      if (typeRecInBacketsEmpty.exec(currentLine)) {
        // 空struct定义
        // headCounts++;
        if (head < 0) {
          head = l;
        }
      } else if (typeRecInBackets.exec(currentLine)) {
        headCounts++;
        if (head < 0) {
          head = l;
        }
      } else if (typeTail.exec(currentLine)) {
        tailCounts++;
      } else if (typesEndRec.exec(currentLine)) {
        break;
      }
      if (headCounts === tailCounts) {
        if (pass) {
          tailLine = l;
          headLine = head;
          break;
        } else {
          head = -1;
        }
      }
    }

    if (tailLine === -1) {
      throw new Error(`不是 struct (${document.fileName} : ${line + 1})`);
    }



  }

  if (headLine === -1) {
    throw new Error(`不是 struct (${document.fileName} : ${line + 1})`);
  }


  return { start: headLine, end: tailLine };
}



async function generate(
  targets: FieldFull[],
  noBackets: boolean = false
): Promise<string> {

  let res = await getValueStrStruct(targets);

  if (noBackets) {
    // 去掉头尾的括号
    res = res.substring(1, res.length - 1);
    return res;
  } else {
    return res;
  }



}

function getKeyStrByType(type: string, tagJson: string): string {
  let k = fixTypeStr(getSuffixName(type));
  if (/^[A-Z]/.test(k)) {
    if (tagJson !== '') {
      if (tagJson === FIELD_TAG_LINE) {
        return '"-":';
      } else if (tagJson === "-") {
        return ''; //表示要隐藏
      } else {
        return '"' + tagJson + '":';
      }
    } else {
      return '"' + k + '":';
    }
  }
  return '';
}

function getKeyStr(field: FieldFull): string[] {

  if (field.names === null) {
    //null 表示隐藏内嵌字段 或者 } 结尾
    if (field.type === FIELD_TYPE_STRUCT_END) {
      if (field.tagJson) {
        if (field.tagJson === FIELD_TAG_LINE) {
          return ['"-":'];
        } else if (field.tagJson === "-") {
          return ['-']; //表示要隐藏
        } else {
          return ['"' + field.tagJson + '":'];
        }
      } else {
        return [];
      }
    } else {
      return ['']; //表示内嵌隐藏字段
    }
  }

  let res = [];
  let tagCount = 0;
  for (let name of field.names) {
    let key = name;
    if (field.tagJson) {
      if (field.tagJson === FIELD_TAG_LINE) {
        if (tagCount === 0) {
          key = '-';
          tagCount++;
        }
      } else if (field.tagJson === "-") {
        key = '';
      } else {
        if (tagCount === 0) {
          key = field.tagJson;
          tagCount++;
        }
      }
    }
    if (key !== '') {
      res.push('"' + key + '":');
    }
  }

  return res;
}

function fixTypeStr(type: string): string {
  if (type.startsWith('*')) {
    return type.substring(1);
  }
  return type;
}

function getValueStrBase(position: vscode.Position,
  document: vscode.TextDocument, type: String): string {


  let value = '';
  switch (type) {
    case 'string':
      value = '"str"';
      break;
    case 'int': case 'int8': case 'int16': case 'int32': case 'int64':
    case 'uint': case 'uint8': case 'uint16': case 'uint32': case 'uint64':
      value = '1234567890123';
      break;
    case 'float32': case 'float64':
      value = '123.456';
      break;
    case 'bool':
      value = 'true';
      break;
    case 'interface{}':
      value = 'null';
      break;
    case 'struct{}': case 'struct':
      value = '{}';
      break;
    case 'error':
      value = '{}';
      break;
    case 'chan': //不支持序列化类型，异常提示
      throw new Error(`该struct不能序列化, 因含有 ${type} 类型字段。 (${document.fileName} : ${position.line + 1})`);
    case 'time.Time': case 'Time:': //常用的第三方类型
      value = '"2024-07-01T15:00:00+08:00"';
      break;
    case 'Decimal': case 'decimal.Decimal': //常用的第三方类型
      value = '123.456';
      break;
    case 'sql.NullTime': case 'NullTime': case 'gorm.DeletedAt'://常用的第三方类型
      value = '"2024-07-01T15:00:00+08:00"';
      break;
    case 'time.Duration': //常用的第三方类型
      value = '1234567890123';
      break;
    default: //其他自定义类型，返回空 ,下一步处理
      value = '';
      break;
  }
  return value;
}

async function getValueStrArray(position: vscode.Position,
  document: vscode.TextDocument, type: string): Promise<string> {
  let value = '';
  //去掉前面[]
  if (type.startsWith('[]')) {
    type = type.substring(2);
  }
  let fixedType = fixTypeStr(type);
  if (fixedType.startsWith('[]')) {
    value = await getValueStrArray(position, document, fixedType);
  } else if (fixedType.startsWith('map[')) {
    value = await getValueStrMap(position, document, fixedType);
  } else {
    value = getValueStrBase(position, document, fixedType);
    if (value === '') {
      //  (2024-07-06) : 自定义类型
      value = (await getValueStrCustomTypeFromPosition(position, document, fixedType)).val;
    }
    if (value === '') {
      return "";//直接返回“”，将不序列化此字段
    }
  }

  return "[" + value + "]"; //value;
}

async function getValueStrMap(position: vscode.Position,
  document: vscode.TextDocument, type: string): Promise<string> {
  let value = '';

  // 找到第一个"]"之后的字符串
  let index = type.indexOf(']');
  if (index > 0) {
    type = type.substring(index + 1);
  }
  let fixedType = fixTypeStr(type);
  if (fixedType.startsWith('[]')) {
    value = await getValueStrArray(position, document, fixedType);
  } else if (fixedType.startsWith('map[')) {
    value = await getValueStrMap(position, document, fixedType);
  } else {
    value = getValueStrBase(position, document, fixedType);
    if (value === '') {
      //  (2024-07-06) : 自定义类型
      value = (await getValueStrCustomTypeFromPosition(position, document, fixedType)).val;
    }
    if (value === '') {
      return "";//直接返回“”，将不序列化此字段
    }
  }

  return '{"key":' + value + '}';
}

// 参数不包含 头{  和 尾} 的field
async function getValueStrStruct(fields: FieldFull[]): Promise<string> {

  let result = '';
  let items: string[] = [];

  // let inerIsArrStruct = false;
  // let inerIsMapStruct = false;
  // let inerStructKey: string = '';
  // let inerStructType: string = '';
  let inerStructStarField: FieldFull | null = null;
  let inerFields: FieldFull[] = [];
  let inerCount = 0;
  // let inerIgore = false;

  // 是否在数组内
  for (let field of fields) {

    let fixedType = fixTypeStr(field.type);

    let keys = getKeyStr(field);

    if (inerCount > 0) {
      if (isInerStructStart(field)) {
        inerCount++;
        inerFields.push(field);
      } else if (fixedType === FIELD_TYPE_STRUCT_END) {
        inerCount--;
        if (inerCount === 0) {
          if (inerStructStarField?.names?.length === 0 || field.tagJson === "-" ||
            (field.tagJson !== "" && inerStructStarField?.names?.length && inerStructStarField?.names.length > 1)) {
            // 不序列化. 删除隐藏字段结构体
          } else {

            let startKeys = getKeyStr(inerStructStarField!);
            let inerStructType = fixTypeStr(inerStructStarField!.type);
            let key = keys[0];
            let tagCounts = 0;

            for (let inerStructKey of startKeys) {
              if (key) {
                if (key === '-') {
                  continue;
                }
                if (tagCounts === 0) {
                  inerStructKey = key;// 重置 structKey, 有 json tag
                  tagCounts++;
                }
              }
              let val = await getValueStrStruct(inerFields);
              if (val !== '') {
                if (inerStructType.startsWith('[][][]')) {
                  val = '[[[' + val + ']]]';
                } else if (inerStructType.startsWith('[][]')) {
                  val = '[[' + val + ']]';
                } else if (inerStructType.startsWith('[]map[')) {
                  if (inerStructType.endsWith('[]struct') || inerStructType.endsWith('[]struct{')) {
                    val = '[{"key":[' + val + ']}]';
                  } else {
                    val = '[{"key":' + val + '}]';
                  }
                } else if (inerStructType.startsWith('[]')) {
                  val = '[' + val + ']';
                } else if (inerStructType.startsWith('map[')) {
                  if (inerStructType.endsWith('[]struct') || inerStructType.endsWith('[]struct{')) {
                    val = '{"key":[' + val + ']}';
                  } else {
                    val = '{"key":' + val + '}';
                  }
                }
                items.push(inerStructKey + val + ',');
              }
            }
          }
          // inerStructKey = '';
          // inerStructType = '';
          inerStructStarField = null;
          inerCount = 0;
          inerFields = [];
          // inerIgore = false;
        } else {
          inerFields.push(field);
        }
      } else {
        inerFields.push(field);
      }

    } else {
      if (keys[0] === '') {
        // 隐藏字段，嵌套 自定义类型
        //  (2024-07-06) : 获取定义的嵌套结构体的字段，生成对应的结构体

        let keyname = getKeyStrByType(fixedType, field.tagJson);
        if (keyname !== '') {
          let v = await getValueStrBase(field.typePosition, field.document, fixedType);
          if (v !== '') {
            items.push(keyname + v + ',');
          } else {
            let noTag = field.tagJson === '';
            let r = await getValueStrCustomTypeFromPosition(field.typePosition, field.document, fixedType, noTag);
            if (r.val !== '') {
              if (r.isStruct) {
                if (noTag) {
                  items.push(r.val + ',');
                } else {
                  items.push(keyname + r.val + ','); //（go json.Marshal 的逻辑）隐藏字段struct类型 有json tag，则有 key
                }
              } else {
                items.push(keyname + r.val + ',');
              }
            }
          }
        }

      } else if (isInerStructStart(field)) {
        inerStructStarField = field;
        // inerStructType = fixedType;
        // if (field.names.length === 0) {
        //   inerIgore = true;
        // } else {
        //   inerIgore = false;
        // }
        inerCount++;
        // inerStructKey = key;
      } else if (fixedType.startsWith('[]')) {
        let val = await getValueStrArray(field.typePosition, field.document, fixedType);
        if (val !== '') {
          for (let key of keys) {
            items.push(key + val + ',');
          }
        }
      } else if (fixedType.startsWith('map[')) {

        let val = await getValueStrMap(field.typePosition, field.document, fixedType);
        if (val !== '') {
          for (let key of keys) {
            items.push(key + val + ',');
          }
        }
      } else {
        let value = getValueStrBase(field.typePosition, field.document, fixedType);
        if (value === '') {
          //  (2024-07-06) : 自定义类型
          value = (await getValueStrCustomTypeFromPosition(field.typePosition, field.document, fixedType)).val;
        }
        if (value !== '') {
          for (let key of keys) {
            items.push(key + value + ',');
          }
        }
      }
    }
  }


  if (items.length > 0) {
    //去掉最后一个逗号
    if (items[items.length - 1].endsWith(',')) {
      items[items.length - 1] = items[items.length - 1].slice(0, -1);
    }
  }

  result = items.join('\n');
  result = '{\n' + result + '\n}';
  return result;
}

// 获取后缀名称
function getSuffixName(type: string): string {
  let index = type.lastIndexOf('.');
  if (index > 0) {
    return type.substring(index + 1);
  }
  return type;
}

async function getValueStrCustomTypeFromPosition(
  position: vscode.Position,
  document: vscode.TextDocument,
  typeName: string,
  noBackets: boolean = false,
  excludeFilePaths: string[] = [],
): Promise<{ val: string, isStruct: boolean }> {

  let isStr = true;
  typeName = getSuffixName(typeName);
  let res = typeName;
  if (noBackets) {
    res = res + '(NoBackets)';
  }

  // let serverModule = 'gopls'; // Assuming gopls is in your PATH
  // let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

  // let serverOptions: ServerOptions = {
  //   run: { module: serverModule, transport: TransportKind.stdio },
  //   debug: { module: serverModule, transport: TransportKind.stdio, options: debugOptions },
  // };

  // let clientOptions: LanguageClientOptions = {
  //   documentSelector: [{ scheme: 'file', language: 'go' }],
  // };

  // let client = new LanguageClient('goLanguageServer', 'Go Language Server', serverOptions, clientOptions);


  // try {
  //   if (client.needsStart()) {
  //     await client.start();
  //   }
  //   let result: vscode.Location = await client.sendRequest('textDocument/definition', {
  //     textDocument: client.code2ProtocolConverter.asTextDocumentIdentifier(document),
  //     position: client.code2ProtocolConverter.asPosition(position),
  //   });

  //   res = `Definition at: ${result.uri}:${result.range.start.line + 1}:${result.range.start.character + 1}`;

  //   vscode.window.showInformationMessage(`Definition at: ${result.uri}:${result.range.start.line + 1}:${result.range.start.character + 1}`);

  //   // 获取定义处的document对象
  //   let textDocument = await vscode.workspace.openTextDocument(result.uri);
  //   // 获取定义处的 第一行string
  //   let line = textDocument.lineAt(result.range.start.line).text;
  //   // 用正则表达式获取类型
  //   let superTypeName = '';
  //   let typeRec = /\s*type\s+[a-zA-Z_\d]+\s+([\*\[\]a-zA-Z_\.\d\{\}]*)/;
  //   let m = typeRec.exec(line);
  //   if (m) {
  //     superTypeName = fixTypeStr(m[1]);
  //   }

  //   // 获取定义处的Positiont对象
  //   let idx = line.indexOf(superTypeName);
  //   let positionNew = new vscode.Position(result.range.start.line, idx);
  //   res = await getValueStrCustomTypeFromPosition(positionNew, textDocument, superTypeName, noBackets);

  // } catch (error) {
  //   vscode.window.showErrorMessage(`gopls err: ${error}`);
  // }
  // if (client.isRunning()) {
  //   await client.stop();
  // }


  let superType = null;

  // 优先 document 所在文件夹
  let f = vscode.workspace.asRelativePath(document.uri);
  const folder = f.substring(0, f.lastIndexOf('/')) + '/**/*.go';
  const currentFiles = await vscode.workspace.findFiles(folder);
  if (currentFiles.length > 0) {
    superType = await getCustomTypeSuperFromFiles(typeName, currentFiles, excludeFilePaths);
  }

  // 再查整个工作空间目录
  if (superType === null) {
    const files = await vscode.workspace.findFiles('**/*.go', folder);
    superType = await getCustomTypeSuperFromFiles(typeName, files, excludeFilePaths);
  }

  if (superType !== null) {

    // filePath 转换成 document
    let textDocument = await vscode.workspace.openTextDocument(superType.filePath);
    let positionNew = new vscode.Position(superType.line, superType.idx);

    if (superType.superTypeName.startsWith('[]')) {
      res = await getValueStrArray(positionNew, textDocument, superType.superTypeName);
      isStr = false;
    } else if (superType.superTypeName.startsWith('map[')) {
      res = await getValueStrMap(positionNew, textDocument, superType.superTypeName);
      isStr = false;
    } else if (superType.superTypeName === 'struct{}') {
      if (noBackets) {
        res = '';
      } else {
        res = '{}';
      }
      isStr = true;
    } else if (superType.superTypeName === 'struct' || superType.superTypeName === 'struct{') {

      const struct = getFields(superType.line, superType.line, textDocument);
      res = await generate(struct, noBackets);
      isStr = true;

      // if (noBackets) {
      //   return '';
      // }
      // return '{}';
    } else {
      let value = getValueStrBase(positionNew, textDocument, superType.superTypeName);
      if (value === '') {
        //  (2024-07-06) : 自定义类型
        // 预防死循环
        if (typeName === superType.superTypeName) {
          excludeFilePaths.push(superType.filePath);
        }
        let res2 = await getValueStrCustomTypeFromPosition(positionNew, textDocument, superType.superTypeName, noBackets, excludeFilePaths);
        value = res2.val;
        isStr = res2.isStruct;
      } else {
        isStr = false;
      }
      res = value;
    }
  }


  return { val: res, isStruct: isStr };
}

async function getCustomTypeSuperFromFiles(
  typeName: string,
  files: vscode.Uri[],
  excludeFilePaths: string[] = [],
): Promise<{ superTypeName: string, line: number, idx: number, filePath: string } | null> {

  // 根据正则内容，获取定义文件及对应的position
  const typesStartRec = new RegExp('^\\s*type\\s*\\(\\s*');
  const typesEndRec = new RegExp('^\\s*\\)\\s*');
  const typeRecSingle = new RegExp('^\\s*type\\s+' + typeName + '\\s+([\\*\\[\\]\\.\\w\\{\\}]+)');
  const typeRecInBackets = new RegExp('^\\s*' + typeName + '\\s+([\\*\\[\\]\\.\\w\\{\\}]+)');

  const typeStructInBackets = /^\s*\w+(\s*,\s*\w+)*\s+[^\/\s]*\]?\*?struct\s*\{/;
  const typeStructInBacketsEmpty = /^\s*\w+(\s*,\s*\w+)*\s+[^\/\s]*\]?\*?struct\s*\{\s*\}/;
  const typeStructTail = /^\s*}/;

  let typeRec = typeRecSingle;
  // 搜索整个工作空间，寻找匹配正则内容的 文件


  for (const file of files) {
    const filePath = file.fsPath;
    if (excludeFilePaths.includes(filePath)) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');

    const lines = content.split('\n');
    let lineCount = 0;
    let idx = 0;
    let superTypeName = '';
    let open = false;
    typeRec = typeRecSingle;
    let structOpen = 0;

    for (const line of lines) {

      if (!open) {
        let start = typesStartRec.exec(line);
        if (start && start[0] !== '') {
          open = true;
          typeRec = typeRecInBackets;
          // continue;
        }
      }

      if (structOpen === 0) { // 否则，可能是结构体内的字段
        let m = typeRec.exec(line);
        if (m) {
          superTypeName = fixTypeStr(m[1]);
          idx = line.indexOf(superTypeName);
          break;
        }
      }

      if (open) {
        if (typeStructInBacketsEmpty.exec(line)) {
          // structOpen++;
        } else if (typeStructInBackets.exec(line)) {
          structOpen++;
        } else if (typeStructTail.exec(line)) {
          structOpen--;
        }

        let end = typesEndRec.exec(line);
        if (end && end[0] !== '') {
          open = false;
          typeRec = typeRecSingle;
          structOpen = 0;
          // continue;
        }
      }
      lineCount++;
    }


    if (superTypeName !== '') {

      return {
        superTypeName: superTypeName,
        line: lineCount,
        idx: idx,
        filePath: filePath
      };

    }

  }
  return null;
}


function isInerStructStart(field: FieldFull): boolean {
  let fixedType = fixTypeStr(field.type);
  if (fixedType === FIELD_TYPE_STRUCT_START || fixedType === FIELD_TYPE_STRUCT_START_2
    || fixedType.endsWith(']struct') || fixedType.endsWith(']struct{')
  ) {
    return true;
  }
  return false;
}