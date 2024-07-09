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
  inTypeBackets: boolean = false
): FieldFull[] {
  let scope: { start: number; end: number };
  try {
    scope = getStructScope(start, document, inTypeBackets);
  } catch (err) {
    if (start === end) throw err;
    scope = getStructScope(end, document, inTypeBackets);
  }

  if (scope.start + 1 > scope.end - 1) {
    throw new Error('invalid struct format');
  }

  let res: number[] = [];
  for (let line = scope.start + 1; line <= scope.end - 1; line++) {
    res.push(line);
  }

  let fields: FieldFull[] = [];
  fields = res.map((line) => {
    const text = document.lineAt(line).text;
    const field = /^\s*([\.\w\}]*)\s*([\*\[\]\.\w\{\}]*)/;
    const tag = /^[^\/]*`.*json:"(\-,)?([^,"]*).*"/;
    const fs = field.exec(text);
    const tagJson = tag.exec(text);
    const tg = tagJson ? tagJson[1] ? tagJson[1] : tagJson[2] : '';
    let pos: vscode.Position = new vscode.Position(line, 0);
    if (fs && fs.length > 1) {
      if (fs.length === 2 || fs[2] === '') {
        if (fs[1] !== '') {
          let idx = text.indexOf(fs[1]);
          pos = new vscode.Position(line, idx);
        }
        return {
          name: '',
          type: fs[1],
          tagJson: tg,
          typePosition: pos,
          document: document
        };
      }
      if (fs[2] !== '') {
        let idx = text.indexOf(fs[2]);
        pos = new vscode.Position(line, idx);
      }
      return {
        name: fs[1],
        type: fs[2],
        tagJson: tg,
        typePosition: pos,
        document: document
      };
    }
    return null;
  }).filter((field): field is FieldFull => {
    if (field === null) {
      return false;
    }
    if (field.tagJson === '-' && field.type !== FIELD_TYPE_STRUCT_END) {
      return false;
    }
    if (field.type === '' || field.type === 'chan') {
      return false;
    }
    //如果 field.name 不是大写开头,且不是内部 struct，那么直接返回 false
    if (field.name !== '' && !/^[A-Z]/.test(field.name) && !isInerStructStart(field)) {
      return false;
    }
    return true;
  });

  return fields;
}

function getStructScope(
  line: number,
  document: vscode.TextDocument,
  inTypeBackets: boolean = false
): { start: number; end: number } {

  const typesStartRec = /^\s*type\s*\(\s*/; //new RegExp('\\s*type\\s*\\(\\s*');
  const typesEndRec = /^\s*\)\s*/; //new RegExp('\\s*\\)\\s*');
  const typeRecSingle = /^\s*type\s+\w+\s+struct\s*\{/; //new RegExp('\\s*type\\s+\\w+\\s+struct\\s*\\{');
  const typeRecInBackets = /^\s*\w+\s+[^\/\s]*\]?\*?struct\s*\{/; //new RegExp('\\s*\\w+\\s+struct\\s*\\{');
  const typeTail = /^\s*}/;

  let headLine = -1;
  let tailLine = -1;
  let backetStartLine = -1;

  // 向上找定义开始行
  for (let l = line; l >= 0; l--) {
    const currentLine = document.lineAt(l).text;
    if (typeRecSingle.exec(currentLine)) {
      headLine = l;
      break;
    }
    if (typesStartRec.exec(currentLine)) {
      backetStartLine = l;
      break;
    }
  }

  if (headLine === -1 && backetStartLine === -1) {
    throw new Error('outside struct 1');
  }

  // 在独立 type struct {} 定义中找到 定义 结束行
  if (headLine > -1) {
    let headCounts = 1;
    let tailCounts = 0;
    for (let l = headLine; l < document.lineCount; l++) {
      const currentLine = document.lineAt(l).text;
      if (typeRecInBackets.exec(currentLine)) {
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
      throw new Error('outside struct 2');
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
      if (typeRecInBackets.exec(currentLine)) {
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
      throw new Error('outside struct 3');
    }

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


function getKeyStr(field: FieldFull): string {
  let key = field.name;
  if (field.tagJson) {
    if (field.tagJson === FIELD_TAG_LINE) {
      key = '-';
    } else if (field.tagJson === "-") {
      key = '';
    } else {
      key = field.tagJson;
    }
  }
  if (key === '') {
    return '';
  }
  return '"' + key + '":';
}

function fixTypeStr(type: string): string {
  if (type.startsWith('*')) {
    return type.substring(1);
  }
  return type;
}

function getValueStrBase(type: String): string {


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
    case 'time.Time': case 'Time:':
      value = '"2024-07-01T15:00:00+08:00"';
      break;
    case 'Decimal': case 'decimal.Decimal': //第三方常用类型
      value = '123.456';
      break;
    case 'sql.NullTime': case 'NullTime'://第三方常用类型
      value = '"2024-07-01T15:00:00+08:00"';
      break;
    default:
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
  } else if (fixedType === "struct" || fixedType === "struct{") {
    value = "{}";
  } else if (fixedType === "interface{}") {
    value = "";
  } else {
    value = getValueStrBase(fixedType);
    if (value === '') {
      //  (2024-07-06) : 自定义类型
      value = await getValueStrCustomTypeFromPosition(position, document, fixedType);
    }
    if (value === '') {
      return "";
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
  } else if (fixedType === "struct" || fixedType === "struct{") {
    value = "{}";
  } else if (fixedType === "interface{}") {
    value = "null";
  } else if (fixedType === "chan") {
    return "";
  } else {
    value = getValueStrBase(fixedType);
    if (value === '') {
      //  (2024-07-06) : 自定义类型
      value = await getValueStrCustomTypeFromPosition(position, document, fixedType);
    }
    if (value === '') {
      return "";
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
  let inerStructKey: string = '';
  let inerStructType: string = '';
  let inerFields: FieldFull[] = [];
  let inerCount = 0;
  let inerIgore = false;

  // 是否在数组内
  for (let field of fields) {

    let fixedType = fixTypeStr(field.type);

    let key = getKeyStr(field);

    if (inerCount > 0) {
      if (isInerStructStart(field)) {
        inerCount++;
        inerFields.push(field);
      } else if (fixedType === FIELD_TYPE_STRUCT_END) {
        inerCount--;
        if (inerCount === 0) {
          if (inerIgore || field.tagJson === "-") {
            // 不序列化. 删除结构体
          } else {
            if (key !== '') {
              inerStructKey = key; // 重置 structKey, 有 json tag
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
          inerStructKey = '';
          inerStructType = '';
          inerCount = 0;
          inerFields = [];
          inerIgore = false;
        } else {
          inerFields.push(field);
        }
      } else {
        inerFields.push(field);
      }

    } else {
      if (key === '' && fixedType !== FIELD_TYPE_STRUCT_END) {
        // 隐藏字段，嵌套 自定义类型
        //  (2024-07-06) : 获取定义的嵌套结构体的字段，生成对应的结构体
        let value = await getValueStrCustomTypeFromPosition(field.typePosition, field.document, fixedType, true);
        if (value !== '') {
          items.push(value + ',');
        }

      } else if (isInerStructStart(field)) {
        inerStructType = fixedType;
        if (field.name !== '' && !/^[A-Z]/.test(field.name)) {
          inerIgore = true;
        } else {
          inerIgore = false;
        }
        inerCount++;
        inerStructKey = key;
      } else if (fixedType.startsWith('[]')) {
        let val = await getValueStrArray(field.typePosition, field.document, fixedType);
        if (val !== '') {
          items.push(key + val + ',');
        }
      } else if (fixedType.startsWith('map[')) {

        let val = await getValueStrMap(field.typePosition, field.document, fixedType);
        if (val !== '') {
          items.push(key + val + ',');
        }
      } else {
        let value = getValueStrBase(fixedType);
        if (value === '') {
          //  (2024-07-06) : 自定义类型
          value = await getValueStrCustomTypeFromPosition(field.typePosition, field.document, fixedType);
        }
        if (value !== '') {
          items.push(key + value + ' ,');
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
  noBackets: boolean = false
): Promise<string> {

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

  // 根据正则内容，获取定义文件及对应的position
  const typesStartRec = new RegExp('^\\s*type\\s*\\(\\s*');
  const typesEndRec = new RegExp('^\\s*\\)\\s*');
  const typeRecSingle = new RegExp('^\\s*type\\s+' + typeName + '\\s+([\\*\\[\\]\\.\\w\\{\\}]+)');
  const typeRecInBackets = new RegExp('^\\s*' + typeName + '\\s+([\\*\\[\\]\\.\\w\\{\\}]+)');
  let typeRec = typeRecSingle;
  // 搜索整个工作空间，寻找匹配正则内容的 文件


  const files = await vscode.workspace.findFiles('**/*.go');

  for (const file of files) {
    const filePath = file.fsPath;
    const content = fs.readFileSync(filePath, 'utf8');

    const lines = content.split('\n');
    let lineCount = 0;
    let idx = 0;
    let superTypeName = '';
    let open = false;
    typeRec = typeRecSingle;

    for (const line of lines) {
      lineCount++;

      if (!open) {
        let start = typesStartRec.exec(line);
        if (start && start[0] !== '') {
          open = true;
          typeRec = typeRecInBackets;
          // continue;
        }
      }

      let m = typeRec.exec(line);
      if (m) {
        superTypeName = fixTypeStr(m[1]);
        idx = line.indexOf(superTypeName);
        break;
      }

      if (open) {
        let end = typesEndRec.exec(line);
        if (end && end[0] !== '') {
          open = false;
          typeRec = typeRecSingle;
          // continue;
        }
      }
    }


    if (superTypeName !== '') {
      // vscode.window.showInformationMessage(`File: ${filePath}, Matching lines: ${lineCount}, Position: ${idx}, Type: ${superTypeName}`);

      // filePath 转换成 document
      let textDocument = await vscode.workspace.openTextDocument(filePath);
      let positionNew = new vscode.Position(lineCount, idx);

      if (superTypeName.startsWith('[]')) {
        res = await getValueStrArray(positionNew, textDocument, superTypeName);
      } else if (superTypeName.startsWith('map[')) {
        res = await getValueStrMap(positionNew, textDocument, superTypeName);
      } else if (superTypeName === 'interface{}') {
        if (noBackets) {
          return '';
        }
        return 'null';
      } else if (superTypeName === 'chan') {
        return '';
      } else if (superTypeName === 'struct' || superTypeName === 'struct{') {

        try {
          const struct = getFields(lineCount, lineCount, textDocument, open);
          res = await generate(struct, noBackets);
        } catch (err: any) {
          vscode.window.showErrorMessage(`getfields err: ${err.toString()}`);
        }

        // if (noBackets) {
        //   return '';
        // }
        // return '{}';
      } else {
        let value = getValueStrBase(superTypeName);
        if (value === '') {
          //  (2024-07-06) : 自定义类型
          value = await getValueStrCustomTypeFromPosition(positionNew, textDocument, superTypeName);
        }
        res = value;
      }

      break;
    }

  }
  return res;
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