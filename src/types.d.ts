declare module "@matrix-org/olm" {
    const Olm: any;
    export = Olm;
}

declare global {
    var Olm: any;
} 