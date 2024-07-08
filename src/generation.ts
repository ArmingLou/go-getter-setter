import * as vscode from 'vscode';
import { FieldFull } from './golang-parser/types';
import { FIELD_TAG_LINE, FIELD_TYPE_STRUCT_Array_START, FIELD_TYPE_STRUCT_Array_START_2, FIELD_TYPE_STRUCT_END, FIELD_TYPE_STRUCT_START, FIELD_TYPE_STRUCT_START_2 } from './constants';



export function executeGenerateCommand(
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
      let result = generate(edit, struct, noBackets);
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
  document: vscode.TextDocument
): FieldFull[] {
  let scope: { start: number; end: number };
  try {
    scope = getStructScope(start, document);
  } catch (err) {
    if (start === end) throw err;
    scope = getStructScope(end, document);
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
    const field = /^\s*([a-zA-Z_\.\d\}]*)\s*([\*\[\]a-zA-Z_\.\d\{\}]*)/;
    const tag = /\s*`.*json:"(\-,)?([^,]*).*"/;
    const fs = field.exec(text);
    const tagJson = tag.exec(text);
    const tg = tagJson ? tagJson[1] ? tagJson[1] : tagJson[2] : '';
    if (fs && fs.length > 1) {
      if (fs.length === 2 || fs[2] === '') {
        return {
          name: '',
          type: fs[1],
          tagJson: tg,
        };
      }

      return {
        name: fs[1],
        type: fs[2],
        tagJson: tg,
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
    if (field.type === '') {
      return false;
    }
    //如果 field.name 不是大写开头
    if (field.name !== '' && !/^[A-Z]/.test(field.name)) {
      return false;
    }
    return true;
  });

  return fields;
}

function getStructScope(
  line: number,
  document: vscode.TextDocument
): { start: number; end: number } {
  const head = /type\s+\w+\s+struct\s*{/;
  const tail = /^\s*}/;

  let headLine = -1;
  let tailLine = -1;
  for (let l = line; l >= 0; l--) {
    const currentLine = document.lineAt(l).text;
    if (head.exec(currentLine)) {
      headLine = l;
      break;
    }
    if (
      l < line &&
      tail.exec(currentLine) &&
      !document.lineAt(l + 1).text.startsWith(currentLine.split('}')[0])
    ) {
      throw new Error('outside struct 2');
    }
  }
  const headText = document.lineAt(headLine).text;
  for (let l = line; l < document.lineCount; l++) {
    const currentLine = document.lineAt(l).text;
    if (
      tail.exec(currentLine) &&
      headText.startsWith(currentLine.split('}')[0])
    ) {
      tailLine = l;
      break;
    }
    if (l > line && head.exec(document.lineAt(l).text)) {
      throw new Error('outside struct');
    }
  }

  if (
    (headLine === -1 && tailLine !== -1) ||
    (headLine !== -1 && tailLine === -1)
  ) {
    throw new Error('invalid struct format');
  }

  if (headLine === -1 && tailLine === -1) {
    throw new Error('no struct to generate');
  }

  return { start: headLine, end: tailLine };
}

function generate(
  editBuilder: vscode.TextEditorEdit,
  targets: FieldFull[],
  noBackets: boolean = false
): string {

  let res = getValueStrStruct(targets);

  if (noBackets) {
    // 去掉头尾的括号
    res = res.substring(1, res.length - 1)
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
    default:
      value = '';
      break;
  }
  return value;
}

function getValueStrArray(type: string): string {
  let value = '';
  //去掉前面[]
  if (type.startsWith('[]')) {
    type = type.substring(2);
  }
  let fixedType = fixTypeStr(type);
  if (fixedType.startsWith('[]')) {
    value = getValueStrArray(fixedType);
  } else if (fixedType.startsWith('map[')) {
    value = getValueStrMap(fixedType);
  } else if (fixedType === "interface{}") {
    value = "";
  } else {
    value = getValueStrBase(fixedType);
    if (value === '') {
      // TODO Arming (2024-07-06) : 自定义类型
      value = getSuffixName(fixedType);
    }
  }

  return "[" + value + "]"; //value;
}

function getValueStrMap(type: string): string {
  let value = '';

  // 找到第一个"]"之后的字符串
  let index = type.indexOf(']');
  if (index > 0) {
    type = type.substring(index + 1);
  }
  let fixedType = fixTypeStr(type);
  if (fixedType.startsWith('[]')) {
    value = getValueStrArray(fixedType);
  } else if (fixedType.startsWith('map[')) {
    value = getValueStrMap(fixedType);
  } else if (fixedType === "interface{}") {
    value = "null";
  } else {
    value = getValueStrBase(fixedType);
    if (value === '') {
      // TODO Arming (2024-07-06) : 自定义类型
      value = getSuffixName(fixedType);
    }
  }

  return '{"key":' + value + '}';
}

// 参数不包含 头{  和 尾} 的field
function getValueStrStruct(fields: FieldFull[], wrapArray: boolean = false): string {
  let result = '';
  let items: string[] = [];

  let inerIsArrStruct = false;
  let inerStructKey: string = '';
  let inerFields: FieldFull[] = [];
  let inerCount = 0;

  fields.forEach((field) => {

    let fixedType = fixTypeStr(field.type);

    let key = getKeyStr(field);

    if (inerCount > 0) {
      if (fixedType === FIELD_TYPE_STRUCT_START || fixedType === FIELD_TYPE_STRUCT_START_2
        || fixedType === FIELD_TYPE_STRUCT_Array_START || fixedType === FIELD_TYPE_STRUCT_Array_START_2
      ) {
        inerCount++;
        inerFields.push(field);
      } else if (fixedType === FIELD_TYPE_STRUCT_END) {
        inerCount--;
        if (inerCount === 0) {
          if (field.tagJson === "-") {
            // 不序列化. 删除结构体
          } else {
            if (key !== '') {
              inerStructKey = key; // 重置 structKey, 有 json tag
            }
            items.push(inerStructKey + getValueStrStruct(inerFields, inerIsArrStruct) + ',');
          }
          inerStructKey = '';
          inerCount = 0;
          inerFields = [];
          inerIsArrStruct = false;
        } else {
          inerFields.push(field);
        }
      } else {
        inerFields.push(field);
      }

    } else {
      if (key === '' && fixedType !== FIELD_TYPE_STRUCT_END) {
        // 隐藏字段，嵌套 自定义类型
        // TODO Arming (2024-07-06) : 获取定义的嵌套结构体的字段，生成对应的结构体
        items.push(getSuffixName(field.type) + '(NoBackets) ,');

      } else if (fixedType === FIELD_TYPE_STRUCT_START || fixedType === FIELD_TYPE_STRUCT_START_2
        || fixedType === FIELD_TYPE_STRUCT_Array_START || fixedType === FIELD_TYPE_STRUCT_Array_START_2) {
        if (fixedType === FIELD_TYPE_STRUCT_Array_START || fixedType === FIELD_TYPE_STRUCT_Array_START_2) {
          inerIsArrStruct = true;
        } else {
          inerIsArrStruct = false;
        }
        inerCount++;
        inerStructKey = key;
      } else if (fixedType.startsWith('[]')) {
        items.push(key + getValueStrArray(fixedType) + ',');
      } else if (fixedType.startsWith('map[')) {
        items.push(key + getValueStrMap(fixedType) + ',');
      } else {
        let value = getValueStrBase(fixedType);
        if (value === '') {
          // TODO Arming (2024-07-06) : 自定义类型
          value = getSuffixName(fixedType);
        }
        items.push(key + value + ' ,');
      }
    }
  });


  if (items.length > 0) {
    //去掉最后一个逗号
    if (items[items.length - 1].endsWith(',')) {
      items[items.length - 1] = items[items.length - 1].slice(0, -1);
    }
  }

  result = items.join('\n');
  result = '{\n' + result + '\n}';
  if (wrapArray) {
    result = '[' + result + ']';
  }
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