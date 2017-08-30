// @flow

const compileExpression = require('../function/compile');
const {BooleanType} = require('../function/types');

import type {Feature} from '../function';
export type FeatureFilter = (globalProperties: {+zoom?: number}, feature: VectorTileFeature) => boolean;

module.exports = createFilter;

/**
 * Given a filter expressed as nested arrays, return a new function
 * that evaluates whether a given feature (with a .properties or .tags property)
 * passes its test.
 *
 * @private
 * @param {Array} filter mapbox gl filter
 * @returns {Function} filter-evaluating function
 */
function createFilter(filter: any): FeatureFilter {
    if (!filter) {
        return (globalProperties, _: VectorTileFeature) => true;
    }

    let expression = Array.isArray(filter) ? convertFilter(filter) : filter.expression;
    if (Array.isArray(expression) && expression[0] !== 'coalesce') {
        expression = ['coalesce', expression, false];
    }
    const compiled = compileExpression(expression, BooleanType);

    if (compiled.result === 'success') {
        return (globalProperties, feature: VectorTileFeature) => {
            const expressionFeature: Feature = {
                properties: feature.properties || {},
                type: feature.type,
                id: typeof feature.id !== 'undefined' ? feature.id : null
            };
            return compiled.function(globalProperties, expressionFeature);
        };
    } else {
        throw new Error(compiled.errors.map(err => `${err.key}: ${err.message}`).join(', '));
    }
}

function convertFilter(filter: ?Array<any>): mixed {
    if (!filter) return true;
    const op = filter[0];
    if (filter.length <= 1) return (op !== 'any');
    const converted =
        op === '==' ? compileComparisonOp(filter[1], filter[2], '==') :
        op === '!=' ? compileComparisonOp(filter[1], filter[2], '!=') :
        op === '<' ||
        op === '>' ||
        op === '<=' ||
        op === '>=' ? compileComparisonOp(filter[1], filter[2], op) :
        op === 'any' ? compileLogicalOp(filter.slice(1), '||') :
        op === 'all' ? compileLogicalOp(filter.slice(1), '&&') :
        op === 'none' ? compileNegation(compileLogicalOp(filter.slice(1), '||')) :
        op === 'in' ? compileInOp(filter[1], filter.slice(2)) :
        op === '!in' ? compileNegation(compileInOp(filter[1], filter.slice(2))) :
        op === 'has' ? compileHasOp(filter[1]) :
        op === '!has' ? compileNegation(compileHasOp(filter[1])) :
        true;
    return converted;
}

function compilePropertyReference(property: string, type?: ?string) {
    if (property === '$type') return ['geometry-type'];
    const ref = property === '$id' ? ['id'] : ['get', property];
    return type ? [type, ref] : ref;
}

function compileComparisonOp(property: string, value: any, op: string) {
    const fallback = op === '!=';
    if (value === null) {
        return [
            'coalesce',
            [op, ['typeof', compilePropertyReference(property)], 'Null'],
            fallback
        ];
    }
    const ref = compilePropertyReference(property, typeof value);
    return ['coalesce', [op, ref, value], fallback];
}

function compileLogicalOp(expressions: Array<Array<any>>, op: string) {
    return [op].concat(expressions.map(convertFilter));
}

function compileInOp(property: string, values: Array<any>) {
    if (values.length === 0) {
        return false;
    }

    const input = compilePropertyReference(property);
    return ["coalesce", ["contains", input, ["array", ["literal", values]]], false];
}

function compileHasOp(property: string) {
    const has = property === '$id' ?
        ['!=', ['typeof', ['id']], 'Null'] :
        ['has', property];
    return has;
}

function compileNegation(filter: boolean | Array<any>) {
    return ['!', filter];
}

