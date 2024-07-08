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
  name: string;
  type: string;
  tagJson: string;
  typePosition: Position;
  document: TextDocument;
};
