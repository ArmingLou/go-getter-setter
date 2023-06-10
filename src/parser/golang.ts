import { JisonParser, JisonParserApi, StateType, SymbolsType, TerminalsType, ProductionsType } from '@ts-jison/parser';
/**
 * parser generated by  @ts-jison/parser-generator 0.4.1-alpha.2
 * @returns Parser implementing JisonParserApi and a Lexer implementing JisonLexerApi.
 */

function hexlify (str:string): string {
  return str.split('')
    .map(ch => '0x' + ch.charCodeAt(0).toString(16))
    .join(', ')
}

export class GoParser extends JisonParser implements JisonParserApi {
    $?: any;
    symbols_: SymbolsType = {"error":2,"pgm":3,"StructType":4,"EOF":5,"STRUCT":6,"LBRACE":7,"FieldList":8,"RBRACE":9,"Field":10,"Id":11,"Type":12,"Tag":13,"SEMICOLON":14,"IDENT":15,"STRING":16,"BSTRING":17,"$accept":0,"$end":1};
    terminals_: TerminalsType = {2:"error",5:"EOF",6:"STRUCT",7:"LBRACE",9:"RBRACE",14:"SEMICOLON",15:"IDENT",16:"STRING",17:"BSTRING"};
    productions_: ProductionsType = [0,[3,2],[4,4],[8,1],[8,2],[10,4],[10,3],[11,1],[12,1],[13,1],[13,1],[13,0]];
    table: Array<StateType>;
    defaultActions: {[key:number]: any} = {4:[2,1],9:[2,7],10:[2,2],11:[2,4]};

    constructor (yy = {}, lexer = new GoLexer(yy)) {
      super(yy, lexer);

      // shorten static method to just `o` for terse STATE_TABLE
      const $V0=[1,9],$V1=[9,14,15],$V2=[9,15];
      const o = JisonParser.expandParseTable;
      this.table = [{3:1,4:2,6:[1,3]},{1:[3]},{5:[1,4]},{7:[1,5]},{1:[2,1]},{8:6,10:7,11:8,15:$V0},{9:[1,10]},{8:11,9:[2,3],10:7,11:8,15:$V0},{12:12,15:[1,13]},{15:[2,7]},{5:[2,2]},{9:[2,4]},o($V1,[2,11],{13:14,16:[1,15],17:[1,16]}),o([9,14,15,16,17],[2,8]),o($V2,[2,6],{14:[1,17]}),o($V1,[2,9]),o($V1,[2,10]),o($V2,[2,5])];
    }

    performAction (yytext:string, yyleng:number, yylineno:number, yy:any, yystate:number /* action[1] */, $$:any /* vstack */, _$:any /* lstack */): any {
/* this == yyval */
          var $0 = $$.length - 1;
        switch (yystate) {
case 1:
 if (yy.trace) yy.trace('returning', $$[$0-1]);
          return $$[$0-1]; 
break;
case 2:
this.$ = $$[$0-1];
break;
case 3:
this.$ = $$[$0] + "; "
break;
case 4:
this.$ = $$[$0-1] + "; " + $$[$0]
break;
case 5:
this.$ = $$[$0-3] + " " + $$[$0-2] + " " + $$[$0-1]
break;
case 6:
this.$ = $$[$0-2] + " " + $$[$0-1] + " " + $$[$0]
break;
case 7: case 8: case 9: case 10:
this.$ = yytext
break;
case 11:
this.$ = null
break;
        }
    }
}


/* generated by @ts-jison/lexer-generator 0.4.1-alpha.2 */
import { JisonLexer, JisonLexerApi } from '@ts-jison/lexer';

export class GoLexer extends JisonLexer implements JisonLexerApi {
    options: any = {"moduleName":"Go"};
    constructor (yy = {}) {
        super(yy);
    }

    rules: RegExp[] = [
        /^(?:\/\/.*)/,
        /^(?:[\s\t]+)/,
        /^(?:struct\b)/,
        /^(?:\{)/,
        /^(?:\})/,
        /^(?:;)/,
        /^(?:")/,
        /^(?:[^\"\n]+)/,
        /^(?:")/,
        /^(?:`)/,
        /^(?:[^"`"\n]+)/,
        /^(?:`)/,
        /^(?:\/\/)/,
        /^(?:\n)/,
        /^(?:[a-zA-Z_][a-zA-Z0-9]*)/,
        /^(?:$)/
    ];
    conditions: any = {"STRING":{"rules":[7,8],"inclusive":false},"BSTRING":{"rules":[10,11],"inclusive":false},"COMMENT":{"rules":[13],"inclusive":false},"INITIAL":{"rules":[0,1,2,3,4,5,6,9,12,14,15],"inclusive":true}}
    performAction (yy:any,yy_:any,$avoiding_name_collisions:any,YY_START:any): any {
          var YYSTATE=YY_START;
        switch($avoiding_name_collisions) {
    case 0:/* ignore comment */
      break;
    case 1:if (yy.trace) yy.trace(`skipping whitespace ${hexlify(yy_.yytext)}`)
      break;
    case 2:return 6
    case 3:return 7
    case 4:return 9
    case 5:return 14;
    case 6:this.begin('STRING');  this.more();
      break;
    case 7:this.more();
      break;
    case 8:this.begin('INITIAL'); return 16; 
    case 9:this.begin('BSTRING');  this.more();
      break;
    case 10:this.more();
      break;
    case 11:this.begin('INITIAL'); return 17; 
    case 12:this.begin('COMMENT'); this.more();
      break;
    case 13:this.begin('INITIAL');
      break;
    case 14:return 15
    case 15:return 5
        }
    }
}


