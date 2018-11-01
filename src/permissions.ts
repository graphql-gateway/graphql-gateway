import {
  GraphQLSchema,
  getNamedType,
  GraphQLField,
  GraphQLObjectType,
  ResponsePath
} from 'graphql';
const merge = require('deepmerge'); // https://github.com/KyleAMathews/deepmerge/pull/124

import { checkPermissionsAndAttributes, getTokenFromRequest } from './jwt';
import { getENV } from './env';

const GRAPHQL_PERMISSIONS_PATH_PREFIX = getENV(
  'GRAPHQL_PERMISSIONS_PATH_PREFIX',
  null
);

type FieldIteratorFn = (
  fieldDef: GraphQLField<any, any>,
  typeName: string,
  fieldName: string
) => void;

const forEachField = (schema: GraphQLSchema, fn: FieldIteratorFn): void => {
  const typeMap = schema.getTypeMap();
  Object.keys(typeMap).forEach(typeName => {
    const type = typeMap[typeName];
    if (
      !getNamedType(type).name.startsWith('__') &&
      type instanceof GraphQLObjectType
    ) {
      const fields = type.getFields();
      Object.keys(fields).forEach(fieldName => {
        const field = fields[fieldName];
        fn(field, typeName, fieldName);
      });
    }
  });
};

const getFullPath = (path: ResponsePath): string => {
  let parts: string[] = [];

  let currentPath = path;
  do {
    if (currentPath) {
      if (typeof currentPath.key === 'string') {
        parts.unshift(currentPath.key);
      }
      currentPath = currentPath.prev;
    }
  } while (currentPath);

  return parts.join(':');
};

const fieldResolver = (prev, typeName, fieldName) => {
  return async (parent, args, ctx, info) => {
    let path = getFullPath(info.path);
    let typePath = `${typeName}:${fieldName}`;

    let pathPrefix = GRAPHQL_PERMISSIONS_PATH_PREFIX;
    if (pathPrefix) {
      path = pathPrefix + ':' + path;
      typePath = pathPrefix + ':' + typePath;
    }

    let jwtInfo = await checkPermissionsAndAttributes(ctx.req, path);
    let jwtTypeInfo = await checkPermissionsAndAttributes(ctx.req, typePath);

    console.log('??', jwtInfo, jwtTypeInfo);
    if (!jwtInfo.allowed && !jwtTypeInfo.allowed) {
      // if (getENV('DEBUG', false)) {
      const token = await getTokenFromRequest(ctx.req);
      throw new Error(
        `access denied for '${path}' or '${typePath}' for ${JSON.stringify(
          token
        )}`
      );
      // }
      return null;
    }

    args = merge(
      args,
      merge(
        (jwtInfo && jwtInfo.attributes) || {},
        (jwtTypeInfo && jwtTypeInfo.attributes) || {}
      )
    );
    console.log(args, path, typePath);
    return prev(parent, args, ctx, info);
  };
};

export const addPermissionsToSchema = (schema: GraphQLSchema) => {
  forEachField(schema, (field, typeName, fieldName) => {
    if (field.resolve) {
      const prev = field.resolve;
      field.resolve = fieldResolver(prev, typeName, fieldName);
    }
  });
};
