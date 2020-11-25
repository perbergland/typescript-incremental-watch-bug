# typescript-incremental-watch-bug

Reproduction project for a typescript bug - https://github.com/microsoft/TypeScript/issues/41690


## Prerequisites (these must be installed)

* nodejs
* ts-node
* yarn

## To reproduce

* Check out repo locally
* yarn install
* ./node_modules/.bin/ts-node-script compileTypescript.ts triggerbug

Notice that every time compilation is invoked, the Hello.tsx is recompiled (emitted)

If you instead invoke it with ./node_modules/.bin/ts-node-script compileTypescript.ts, it will only be recompiled if there have been changes

