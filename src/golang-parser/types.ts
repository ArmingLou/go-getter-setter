import { Position, TextDocument } from "vscode";

export type Struct = {
  name: string;
  fields: Field[];
};

type Field = {
  name: string;
  type: string;
};



export type FieldFull = {
  names: string[] | null;//null 表示隐藏内嵌字段 或者 } 结尾
  type: string;
  tagJson: string;
  typePosition: Position;
  document: TextDocument;
};
