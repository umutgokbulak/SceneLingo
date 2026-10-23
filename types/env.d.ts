// What the extension's scripts find around them that TypeScript does not know of itself: the
// extension API (used loosely here: it is a large API, and its shape is not what is checked), and
// Node's module object, which the pure scripts look for to be tested.
declare var chrome: any;
declare var module: any;
declare function require(name: string): any;
declare var importScripts: ((...urls: string[]) => void) | undefined;
// The browser's own translator (Chrome 138 and later), where there is one.
declare var Translator: any;
