import * as Path from 'path';
import * as _ from 'lodash';
import * as ReactDocgen from 'react-docgen';
import * as reactDocgenHandlers from 'react-docgen/dist/handlers';
import actualNameHandler from './actualNameHandler';

const defaultHandlers = Object.values(reactDocgenHandlers).map(handler => handler);
const handlers = [...defaultHandlers, actualNameHandler]

export default function({ types: t }) {
  return {
    visitor: {
      Program: {
        exit(path, state) {
          injectReactDocgenInfo(path, state, this.file.code, t);
        }
      }
    },
  };
}

function injectReactDocgenInfo(path, state, code, t) {
  const program = path.scope.getProgramParent().path;

  let docgenResults = [];
  try {
    let resolver = ReactDocgen.resolver.findAllExportedComponentDefinitions;
    if (state.opts.resolver) {
      resolver = ReactDocgen.resolver[state.opts.resolver];
    }
    docgenResults = ReactDocgen.parse(code, resolver, handlers);

    if (state.opts.removeMethods) {
      docgenResults.forEach(function(docgenResult) {
        delete docgenResult.methods;
      })
    }
  } catch(e) {
    // this is for debugging the error only, do not ship this console log or else it pollutes the webpack output
    // console.log(code);
    // console.log(e);
    return;
  }

  docgenResults.forEach(function(docgenResult, index) {
    let exportName = docgenResult.actualName;
    if ( ! exportName) {
      return null;
    }

    const docNode = buildObjectExpression(docgenResult, t);
    const docgenInfo = t.expressionStatement(
      t.assignmentExpression(
        "=",
        t.memberExpression(t.identifier(exportName), t.identifier('__docgenInfo')),
        docNode,
      ),
    );
    program.pushContainer('body', docgenInfo);

    injectDocgenGlobal(exportName, path, state, t);
  });
}

function injectDocgenGlobal(className, path, state, t) {
  const program = path.scope.getProgramParent().path;

  if(!state.opts.DOC_GEN_COLLECTION_NAME) {
    return;
  }

  const globalName = state.opts.DOC_GEN_COLLECTION_NAME;
  const filePath = Path.relative('./', Path.resolve('./', path.hub.file.opts.filename));
  const globalNode = t.ifStatement(
    t.binaryExpression(
      '!==',
      t.unaryExpression(
        'typeof',
        t.identifier(globalName)
      ),
      t.stringLiteral('undefined')
    ),
    t.blockStatement([
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.memberExpression(
            t.identifier(globalName),
            t.stringLiteral(filePath),
            true
          ),
          t.objectExpression([
            t.objectProperty(
              t.identifier('name'),
              t.stringLiteral(className)
            ),
            t.objectProperty(
              t.identifier('docgenInfo'),
              t.memberExpression(
                t.identifier(className),
                t.identifier('__docgenInfo')
              )
            ),
            t.objectProperty(
              t.identifier('path'),
              t.stringLiteral(filePath)
            )
          ])
        )
      )
    ])
  );
  program.pushContainer('body', globalNode);
}

function buildObjectExpression(obj, t){
  if(_.isPlainObject(obj)) {
    const children = [];
    for (let key in obj) {
      if (key === 'actualName') continue;
      if(!obj.hasOwnProperty(key) || _.isUndefined(obj[key])) continue;
      children.push(
        t.objectProperty(
          t.stringLiteral(key),
          buildObjectExpression(obj[key], t)
        ));
    }
    return t.objectExpression(children);
  } else if (_.isString(obj)) {
    return t.stringLiteral(obj);
  } else if (_.isBoolean(obj)) {
    return t.booleanLiteral(obj);
  } else if (_.isNumber(obj)){
    return t.numericLiteral(obj);
  } else if (_.isArray(obj)) {
    const children = [];
    obj.forEach(function (val) {
      children.push(buildObjectExpression(val, t));
    });
    return t.ArrayExpression(children);
  } else if(_.isNull(obj)) {
    return t.nullLiteral();
  }
}
