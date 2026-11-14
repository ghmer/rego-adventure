/*
   Copyright 2025 Mario Enrico Ragucci

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

import js from '@eslint/js';
import globals from 'globals';

// Pack media on the same origin sits behind the token check; img, audio
// and stylesheet elements cannot send a bearer token. An element source
// assigned a pack path directly re-breaks authenticated mode silently:
// the URL must be resolved through the asset service, which issues a
// blob URL or hands back the plain path.
const PACK_MEDIA_MARKER = '/quests/';
const MEDIA_TARGETS = ['src', 'href', 'backgroundImage'];

/**
 * Best-effort string value of a node: literals, template literals, their
 * concatenations and tainted identifiers. Empty when the node has no
 * string shape.
 * @param {Object|null} node - AST node
 * @param {Set<string>} tainted - Variable names initialized with a pack path
 * @returns {string} String value, or the taint marker for tainted names
 */
function stringText(node, tainted) {
    if (!node) {
        return '';
    }
    switch (node.type) {
        case 'Literal':
            return typeof node.value === 'string' ? node.value : '';
        case 'TemplateLiteral':
            return node.quasis.map(quasi => quasi.value.cooked ?? quasi.value.raw).join('');
        case 'BinaryExpression':
            return node.operator === '+' ? stringText(node.left, tainted) + stringText(node.right, tainted) : '';
        case 'Identifier':
            return tainted.has(node.name) ? PACK_MEDIA_MARKER : '';
        case 'AwaitExpression':
            return stringText(node.argument, tainted);
        default:
            return '';
    }
}

/**
 * Whether an assignment target writes an element source.
 * @param {Object|null} left - Assignment target node
 * @returns {boolean} True for .src, .href and .backgroundImage targets
 */
function isMediaTarget(left) {
    if (!left || left.type !== 'MemberExpression') {
        return false;
    }
    const property = left.computed && left.property.type === 'Literal'
        ? left.property.value
        : left.property.name;
    return typeof property === 'string' && MEDIA_TARGETS.includes(property);
}

/**
 * Whether an assignment writes a pack path into an element source.
 * @param {Object} node - AssignmentExpression node
 * @param {Set<string>} tainted - Tainted variable names
 * @returns {boolean} True for a direct pack-media assignment
 */
function isBareMediaAssignment(node, tainted) {
    return node.type === 'AssignmentExpression' && isMediaTarget(node.left) &&
        stringText(node.right, tainted).includes(PACK_MEDIA_MARKER);
}

/**
 * Sub-nodes of an AST node, excluding bookkeeping properties.
 * @param {Object} node - AST node
 * @returns {Array<Object>} Child nodes
 */
function childrenOf(node) {
    const kids = [];
    for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'range' || key === 'loc') {
            continue;
        }
        const child = node[key];
        if (Array.isArray(child)) {
            kids.push(...child);
        } else if (child && typeof child === 'object' && typeof child.type === 'string') {
            kids.push(child);
        }
    }
    return kids;
}

/**
 * Flag element-source assignments that carry a pack-media path. A
 * variable that a string literal, template or concatenation initialized
 * with a pack path taints every assignment fed from it.
 * @param {Object} ruleContext - ESLint rule context
 * @returns {Object} AST listeners
 */
function noBarePackMedia(ruleContext) {
    const tainted = new Set();

    return {
        VariableDeclarator(node) {
            if (node.init && node.id.type === 'Identifier' &&
                stringText(node.init, tainted).includes(PACK_MEDIA_MARKER)) {
                tainted.add(node.id.name);
            }
        },

        // The taint set is complete only after traversal, so the checks
        // run in a second pass over the finished tree.
        'Program:exit'(program) {
            const walk = (node) => {
                if (!node || typeof node.type !== 'string') {
                    return;
                }
                if (isBareMediaAssignment(node, tainted)) {
                    ruleContext.report({
                        node: node.left,
                        message: 'Element sources cannot carry a bearer token: resolve the pack media path through AssetService.mediaURL instead of assigning it directly.'
                    });
                }
                childrenOf(node).forEach(walk);
            };
            walk(program);
        }
    };
}

const localPlugin = {
    meta: { name: 'local' },
    rules: {
        'no-bare-pack-media': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'Element sources must resolve pack media paths through the asset service'
                },
                schema: []
            },
            create: noBarePackMedia
        }
    }
};

export default [
    {
        ignores: ['node_modules/**', 'public/**', 'scripts/**']
    },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser
            }
        },
        plugins: {
            local: localPlugin
        },
        rules: {
            'no-unused-vars': ['error', { args: 'all', argsIgnorePattern: '^_', caughtErrors: 'all' }],
            'no-console': 'off',
            'max-lines-per-function': ['error', 85],
            'complexity': ['error', 12],
            'max-depth': ['error', 4],
            'local/no-bare-pack-media': 'error'
        }
    },
    {
        files: ['**/*.test.js'],
        rules: {
            // A describe() callback is a suite container, not a unit of
            // logic; the it() bodies inside it stay under the size gates.
            'max-lines-per-function': 'off'
        }
    }
];
