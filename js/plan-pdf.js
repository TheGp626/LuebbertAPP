// Reads a weekly-plan PDF with pdf.js into plain page data for plan-parser.js:
// { width, height, items:[{s,x,y,w,h}], hlines:[{x0,x1,y}], fills:[{x0,y0,x1,y1,color}] }
// Coordinates are top-left based (y grows downwards). Runs in the browser only.

function _planMul(m, n) {
  return [m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1], m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3],
          m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5]];
}
function _planApply(m, x, y) { return [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]]; }

function _planHex(args) {
  if (typeof args[0] === 'string') return args[0].toLowerCase();
  var h = function(v) { v = Math.round(v); return (v < 16 ? '0' : '') + v.toString(16); };
  var max = Math.max(args[0], args[1], args[2]);
  var k = max <= 1 ? 255 : 1;
  return '#' + h(args[0]*k) + h(args[1]*k) + h(args[2]*k);
}

// Filled rectangles from the operator list. Thin ones are table borders, the rest cell backgrounds.
async function _planShapes(page, viewport) {
  var OPS = pdfjsLib.OPS, list = await page.getOperatorList();
  var ctm = [1, 0, 0, 1, 0, 0], stack = [], fill = '#000000', fillStack = [], pending = [];
  var hlines = [], fills = [];
  function flush(doFill) {
    if (doFill) pending.forEach(function(r) {
      // to viewport (top-left) coordinates
      var a = viewport.convertToViewportPoint(r[0], r[1]), b = viewport.convertToViewportPoint(r[2], r[3]);
      var x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      if (y1 - y0 < 2 && x1 - x0 > 20) hlines.push({ x0: x0, x1: x1, y: (y0 + y1) / 2 });
      else if (x1 - x0 > 20 && y1 - y0 >= 2) fills.push({ x0: x0, y0: y0, x1: x1, y1: y1, color: fill });
    });
    pending = [];
  }
  for (var i = 0; i < list.fnArray.length; i++) {
    var fn = list.fnArray[i], args = list.argsArray[i];
    if (fn === OPS.save) { stack.push(ctm.slice()); fillStack.push(fill); }
    else if (fn === OPS.restore) { ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; fill = fillStack.pop() || fill; }
    else if (fn === OPS.transform) ctm = _planMul(ctm, args);
    else if (fn === OPS.setFillRGBColor || fn === OPS.setFillColor) fill = _planHex(args);
    else if (fn === OPS.setFillGray) fill = _planHex([args[0], args[0], args[0]]);
    else if (fn === OPS.constructPath) {
      // Rectangles come either as `re` ops or as moveTo/lineTo polygons (Excel exports differ) →
      // every sub-path is taken by its bounding box
      var ops = args[0], co = args[1], j = 0, poly = null;
      var endPoly = function() { if (poly && poly.length > 2) pending.push(poly.bbox); poly = null; };
      var addPt = function(x, y) {
        var p = _planApply(ctm, x, y);
        if (!poly) poly = { length: 0, bbox: [p[0], p[1], p[0], p[1]] };
        poly.length++;
        poly.bbox = [Math.min(poly.bbox[0], p[0]), Math.min(poly.bbox[1], p[1]), Math.max(poly.bbox[2], p[0]), Math.max(poly.bbox[3], p[1])];
      };
      for (var k = 0; k < ops.length; k++) {
        if (ops[k] === OPS.rectangle) {
          endPoly();
          var x = co[j], y = co[j+1], w = co[j+2], h = co[j+3];
          var p = _planApply(ctm, x, y), q = _planApply(ctm, x + w, y + h);
          pending.push([p[0], p[1], q[0], q[1]]);
          j += 4;
        } else if (ops[k] === OPS.moveTo) { endPoly(); addPt(co[j], co[j+1]); j += 2; }
        else if (ops[k] === OPS.lineTo) { addPt(co[j], co[j+1]); j += 2; }
        else if (ops[k] === OPS.curveTo) j += 6;
        else if (ops[k] === OPS.curveTo2 || ops[k] === OPS.curveTo3) j += 4;
        else if (ops[k] === OPS.closePath) endPoly();
      }
      endPoly();
    }
    else if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke || fn === OPS.eoFillStroke ||
             fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) flush(true);
    else if (fn === OPS.endPath || fn === OPS.stroke || fn === OPS.closeStroke) flush(false);
  }
  return { hlines: hlines, fills: fills };
}

async function readPlanPdf(arrayBuffer) {
  var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  var pages = [];
  for (var n = 1; n <= pdf.numPages; n++) {
    var page = await pdf.getPage(n), viewport = page.getViewport({ scale: 1 });
    var tc = await page.getTextContent();
    var items = [];
    tc.items.forEach(function(it) {
      if (!it.str || !it.str.trim()) return;
      var t = it.transform, pt = viewport.convertToViewportPoint(t[4], t[5]);
      var h = Math.abs(t[3]) || Math.abs(t[0]) || 8;
      items.push({ s: it.str, x: pt[0], y: pt[1] - h, w: it.width, h: h });
    });
    var shapes = await _planShapes(page, viewport);
    pages.push({ width: viewport.width, height: viewport.height, items: items, hlines: shapes.hlines, fills: shapes.fills });
  }
  return pages;
}
