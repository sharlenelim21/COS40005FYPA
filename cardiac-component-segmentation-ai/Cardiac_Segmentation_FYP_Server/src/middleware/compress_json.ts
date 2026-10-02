// Description: gzip for large JSON replies, with Node's own zlib.
// A 4D project's segmentation results are 1.5-2.3 MB of RLE text (measured 2026-09-29), which gzip shrinks many
// times over. Only res.json() is compressed, and only when the client accepts gzip and the body is large enough:
// files, streams and every other reply are left as they were. No package is added, because the app container runs
// the node_modules baked into its image.
import zlib from "zlib";
import { NextFunction, Request, RequestHandler, Response } from "express";

export const MIN_COMPRESS_BYTES = 8 * 1024;

export function compressJson(minBytes: number = MIN_COMPRESS_BYTES): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!/\bgzip\b/i.test(String(req.headers["accept-encoding"] ?? ""))) return next();
    const sendJson = res.json.bind(res);
    res.json = (body?: unknown) => {
      const text = JSON.stringify(body);
      if (text === undefined || Buffer.byteLength(text) < minBytes || res.headersSent || res.getHeader("Content-Encoding")) {
        return sendJson(body);
      }
      // Level 1: about a third of level 6's time for nearly the same size, so a local reply is barely slower.
      zlib.gzip(text, { level: 1 }, (error, compressed) => {
        if (res.headersSent) return;
        if (error) {
          sendJson(body); // never fail a reply because it could not be compressed
          return;
        }
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Content-Length", compressed.length);
        res.vary("Accept-Encoding");
        res.end(compressed);
      });
      return res;
    };
    next();
  };
}
