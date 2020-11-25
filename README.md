# typescript-incremental-watch-bug

Reproduction project for a typescript bug (github issue tbd).


## Prerequisites (these must be installed)

* nodejs
* ts-node
* yarn

## To reproduce

* Check out repo locally
* yarn install
* ./compileTypescript.ts triggerbug

Notice that every time compilation is invoked, the Hello.tsx is recompiled (emitted)

If you instead invoke it with ./compileTypescript.ts, it will only be recompiled if there have been changes

