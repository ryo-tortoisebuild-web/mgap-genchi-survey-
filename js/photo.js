/* 写真取り込み：canvasで縮小してJPEG(Base64)化 */
window.App = window.App || {};

(function () {
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('画像を読み込めませんでした')); };
      img.src = url;
    });
  }

  function resize(file, maxSide, quality) {
    maxSide = maxSide || 1280;
    quality = quality || 0.7;
    var url = URL.createObjectURL(file);
    return loadImage(url).then(function (img) {
      var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth * scale));
      var h = Math.max(1, Math.round(img.naturalHeight * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      return { dataUrl: canvas.toDataURL('image/jpeg', quality), width: w, height: h };
    }).catch(function (err) {
      URL.revokeObjectURL(url);
      throw err;
    });
  }

  App.photo = {
    /* File → 縮小済みJPEG dataURL（長辺maxSide px） */
    fileToDataUrl: function (file, maxSide, quality) {
      return resize(file, maxSide, quality).then(function (r) { return r.dataUrl; });
    },

    /* File → { dataUrl, width, height }（間取り背景など、実寸が必要な場面用） */
    fileToDataUrlSized: function (file, maxSide, quality) {
      return resize(file, maxSide, quality);
    },

    /* 写真オブジェクトの実ピクセル寸法(w,h)を保証して返す。
       旧データ(w/h無し)はdataUrlから読み込んで補完・保存する。
       書き込みレイヤーのviewBox座標系に使用 */
    ensureDims: function (photo) {
      if (photo.w && photo.h) return Promise.resolve({ w: photo.w, h: photo.h });
      return loadImage(photo.dataUrl).then(function (img) {
        photo.w = img.naturalWidth || 1000;
        photo.h = img.naturalHeight || 750;
        return { w: photo.w, h: photo.h };
      });
    },
  };
})();
