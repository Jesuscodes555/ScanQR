// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

//Agregar soporte a recursos  de wasm 
config.resolver.assetExts.push('wasm');

//Agregar headers COEP y COOP para SharedArrayBuffer
config.server.enhanceMiddleware = ( middleware) => {
    return (req, res, next) => {
        res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        middleware(req,res,next);
    }
} 
module.exports = config;
