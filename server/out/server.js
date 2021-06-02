"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = node_1.createConnection(node_1.ProposedFeatures.all);
// Create a simple text document manager.
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;
connection.onInitialize((params) => {
    const capabilities = params.capabilities;
    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);
    hasWorkspaceFolderCapability = !!(capabilities.workspace && !!capabilities.workspace.workspaceFolders);
    hasDiagnosticRelatedInformationCapability = !!(capabilities.textDocument &&
        capabilities.textDocument.publishDiagnostics &&
        capabilities.textDocument.publishDiagnostics.relatedInformation);
    const result = {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports code completion.
            completionProvider: {
                resolveProvider: true
            },
            // Tell the client that this server supports formatting.
            documentFormattingProvider: true,
            // Tell the client that this server supports going to definition.
            definitionProvider: true
        }
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        };
    }
    return result;
});
connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(node_1.DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            connection.console.log('Workspace folder change event received.');
        });
    }
});
// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings = { maxNumberOfProblems: 1000 };
let globalSettings = defaultSettings;
const Port = {
    make: (s) => {
        return { all: s, index: 0, pos: { line: 0, character: 0 } };
    },
    atEOF: (p) => {
        return p.index == p.all.length;
    },
    peek: (st) => {
        if (st.index < st.all.length) {
            return st.all[st.index];
        }
        else {
            throw null;
        }
    },
    rest: ({ all, index, pos: { line, character } }) => {
        if (index < all.length) {
            index = index + 1;
            if (all[index - 1] === "\n") {
                line = line + 1;
                character = 0;
            }
            else {
                character = character + 1;
            }
            return { all, index, pos: { line, character } };
        }
        else {
            throw null;
        }
    },
    startsWith(p, s) {
        let i = 0;
        while (p.index + i < p.all.length && p.all[p.index + i] === s[i]) {
            i++;
        }
        return (i === s.length);
    },
    checkFirst(p, f) {
        return (p.index < p.all.length && f(p.all[p.index]));
    }
};
function isLetter(c) {
    return ("a" <= c && c <= "z");
}
function isWhite(c) {
    return (c === " " || c === "\n" || c === "\t");
}
function parse(code) {
    let port = Port.make(code);
    function parseVariable() {
        const start = port.pos;
        if (Port.checkFirst(port, isLetter)) {
            let name = Port.peek(port);
            eat(1);
            while (Port.checkFirst(port, isLetter)) {
                name += Port.peek(port);
                eat(1);
            }
            const end = port.pos;
            return { kind: "var", name, start: start, end: end };
        }
        else {
            throw {
                pos: port.pos,
                reason: "Expecting a variable"
            };
        }
    }
    function parseSpace() {
        if (Port.checkFirst(port, isWhite)) {
            eat(1);
            while (Port.checkFirst(port, isWhite)) {
                eat(1);
            }
            return;
        }
        else {
            throw {
                pos: port.pos,
                reason: "Expecting a whitespace or a newline."
            };
        }
    }
    function eat(n) {
        for (; n > 0; n--) {
            port = Port.rest(port);
        }
        return;
    }
    function assertNext(s) {
        if (Port.startsWith(port, s)) {
            eat(s.length);
        }
        else {
            throw {
                pos: port.pos,
                reason: "Expecting '" + s + "'"
            };
        }
    }
    function parseEOF() {
        if (Port.atEOF(port)) {
            return;
        }
        else {
            throw {
                pos: port.pos,
                reason: "Expecting EOF"
            };
        }
    }
    function parseAtom() {
        if (Port.startsWith(port, "function(")) {
            assertNext("function(");
            const name = parseVariable();
            assertNext("):");
            parseSpace();
            const body = parseTerm();
            parseSpace();
            assertNext("end");
            return { kind: "fun", name, body };
        }
        else if (Port.startsWith(port, "let ")) {
            assertNext("let ");
            const name = parseVariable();
            parseSpace();
            assertNext("=");
            parseSpace();
            const init = parseTerm();
            parseSpace();
            const body = parseTerm();
            return { kind: "let", name: name, init: init, body: body };
        }
        else {
            return parseVariable();
        }
    }
    function parseTerm() {
        let atom = parseAtom();
        while (Port.startsWith(port, "(")) {
            assertNext("(");
            const operator = atom;
            const operand = parseTerm();
            assertNext(")");
            atom = { kind: "app", operator: operator, operand: operand };
        }
        return atom;
    }
    const term = parseTerm();
    parseEOF();
    return term;
}
// Cache the settings of all open documents
const documentSettings = new Map();
const documentContents = new Map();
connection.onDidChangeConfiguration(change => {
    if (hasConfigurationCapability) {
        // Reset all cached document settings
        documentSettings.clear();
    }
    else {
        globalSettings = ((change.settings.languageServerExample || defaultSettings));
    }
    // Revalidate all open text documents
    documents.all().forEach(validateTextDocument);
});
// Only keep settings for open documents
documents.onDidClose(e => {
    documentSettings.delete(e.document.uri);
});
// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});
async function validateTextDocument(textDocument) {
    const diagnostics = [];
    const text = textDocument.getText();
    try {
        documentContents.delete(textDocument.uri);
        documentContents.set(textDocument.uri, parse(text));
    }
    catch (e) {
        const parseError = e;
        const parseDiagnostic = {
            severity: node_1.DiagnosticSeverity.Error,
            range: {
                start: parseError.pos,
                end: parseError.pos,
            },
            message: parseError.reason,
            source: 'parser'
        };
        diagnostics.push(parseDiagnostic);
    }
    const term = documentContents.get(textDocument.uri);
    if (term) {
        const table = [];
        const walk = (t, env) => {
            if (t.kind == "var") {
                table.push({ from: t, to: env.get(t.name) || null });
            }
            else if (t.kind == "fun") {
                table.push({ from: t.name, to: t.name });
                walk(t.body, (new Map(env)).set(t.name.name, t.name));
            }
            else if (t.kind == "app") {
                walk(t.operator, env);
                walk(t.operand, env);
            }
            else {
                walk(t.init, env);
                walk(t.body, (new Map(env)).set(t.name.name, t.name));
            }
        };
        walk(term, new Map());
        const unboundIDs = table.flatMap(({ from, to }) => {
            if (to === null) {
                return [from];
            }
            else {
                return [];
            }
        });
        for (const id of unboundIDs) {
            diagnostics.push({
                "range": {
                    "start": id.start,
                    "end": id.end
                },
                "message": "`" + id.name + "` is not defined"
            });
        }
        diagnostics.push();
    }
    // Send the computed diagnostics to VSCode.
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}
connection.onDidChangeWatchedFiles(_change => {
    // Monitored files have change in VSCode
    connection.console.log('We received an file change event');
});
function prettyPrint(term) {
    function indent(offset) {
        if (offset === 0) {
            return "";
        }
        else {
            return "  " + indent(offset - 1);
        }
    }
    function ppTerm(offset, term) {
        if (term.kind === "var") {
            return term.name;
        }
        else if (term.kind === "fun") {
            return [
                "function(" + term.name.name + "):",
                indent(offset + 1) + ppTerm(offset + 1, term.body),
                indent(offset) + "end"
            ].join("\n");
        }
        else if (term.kind === "app") {
            return ppTerm(offset, term.operator) + "(" + ppTerm(offset, term.operand) + ")";
        }
        else if (term.kind === "let") {
            return [
                "let " + term.name.name + " =",
                indent(offset + 1) + ppTerm(offset + 1, term.init),
                indent(offset) + ppTerm(offset, term.body)
            ].join("\n");
        }
        else {
            return "";
        }
    }
    return ppTerm(0, term);
}
connection.onDocumentFormatting((params, token, workDoneProgress, resultProgress) => {
    const { textDocument: { uri }, options } = params;
    const term = documentContents.get(uri);
    const formattedText = prettyPrint(term);
    const result = [];
    result.push({
        range: {
            start: { line: 0, character: 0 },
            end: { line: Number.MAX_VALUE, character: Number.MAX_VALUE }
        },
        newText: formattedText || ""
    });
    return result;
});
function positionBefore(p1, p2) {
    return (p1.line < p2.line) || (p1.line == p2.line && p1.character <= p2.character);
}
connection.onDefinition((params) => {
    const { position, textDocument: { uri } } = params;
    const term = documentContents.get(uri);
    const table = [];
    function walk(t, env) {
        if (t.kind == "var") {
            table.push({ from: t, to: env.get(t.name) || null });
        }
        else if (t.kind == "fun") {
            table.push({ from: t.name, to: t.name });
            walk(t.body, (new Map(env)).set(t.name.name, t.name));
        }
        else if (t.kind == "app") {
            walk(t.operator, env);
            walk(t.operand, env);
        }
        else {
            walk(t.init, env);
            walk(t.body, (new Map(env)).set(t.name.name, t.name));
        }
    }
    walk(term, new Map());
    const result = [];
    for (const { from, to } of table) {
        if (to !== null && positionBefore(from.start, position) && positionBefore(position, from.end)) {
            result.push({
                uri: uri,
                range: {
                    start: to.start,
                    end: to.end
                }
            });
        }
    }
    return result;
});
// This handler provides the initial list of the completion items.
connection.onCompletion((_textDocumentPosition) => {
    // The pass parameter contains the position of the text document in
    // which code complete got requested. For the example we ignore this
    // info and always provide the same completion items.
    return [
        {
            label: 'TypeScript',
            kind: node_1.CompletionItemKind.Text,
            data: 1
        },
        {
            label: 'JavaScript',
            kind: node_1.CompletionItemKind.Text,
            data: 2
        }
    ];
});
// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item) => {
    if (item.data === 1) {
        item.detail = 'TypeScript details';
        item.documentation = 'TypeScript documentation';
    }
    else if (item.data === 2) {
        item.detail = 'JavaScript details';
        item.documentation = 'JavaScript documentation';
    }
    return item;
});
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);
// Listen on the connection
connection.listen();
//# sourceMappingURL=server.js.map