// @flow

const compileExpression = require('../function/compile');
const {BooleanType} = require('../function/types');
const {typeOf} = require('../function/values');

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
        return () => true;
    }

    let expression = Array.isArray(filter) ? convertFilter(filter) : filter.expression;
    let fallback = false;

    // unwrap 'coalesce' if it's the outermost expression
    if (
        Array.isArray(expression) &&
        expression.length === 3 &&
        expression[0] === 'coalesce' &&
        typeof expression[2] === 'boolean'
    ) {
        fallback = expression[2];
        expression = expression[1];
    }

    const compiled = compileExpression(expression, BooleanType);

    if (compiled.result === 'success') {
        return (globalProperties, feature: VectorTileFeature) => {
            try {
                const result = compiled.function(globalProperties, {
                    properties: feature.properties || {},
                    type: feature.type,
                    id: typeof feature.id !== 'undefined' ? feature.id : null
                });
                if (result !== null) return result;
            } catch (e) { return fallback; }
            return fallback;
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
        op === 'any' ? compileDisjunctionOp(filter.slice(1)) :
        op === 'all' ? ['&&'].concat(filter.slice(1).map(convertFilter)) :
        op === 'none' ? ['&&'].concat(filter.slice(1).map(convertFilter).map(compileNegation)) :
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
    let compare;
    if (value === null) {
        compare = [op, ['typeof', compilePropertyReference(property)], 'Null'];
    } else {
        const ref = compilePropertyReference(property, typeof value);
        compare = [op, ref, value];
    }

    if (op === '!=') {
        const ref = compilePropertyReference(property);
        const type = typeOf(value).kind;
        return [
            '||',
            ['!', compileHasOp(property)],
            ['!=', ['typeof', ref], type],
            compare
        ];
    } else {
        return compare;
    }
}

function compileDisjunctionOp(filters: Array<Array<any>>) {
    return ['||'].concat(filters.map(convertFilter).map(compiled => ['coalesce', compiled, false]));
}

function compileInOp(property: string, values: Array<any>) {
    if (values.length === 0) {
        return false;
    }

    const input = compilePropertyReference(property);
    return ["contains", input, ["array", ["literal", values]]];
}

function compileHasOp(property: string) {
    const has = property === '$id' ?  ['!=', ['typeof', ['id']], 'Null'] :
        property === '$type' ? true :
        ['has', property];
    return has;
}

function compileNegation(filter: mixed) {
    return ['coalesce', ['!', filter], true];
}

