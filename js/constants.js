/* 定義定数：カテゴリ・職人タグ・状態区分 */
window.App = window.App || {};

App.CATEGORIES = [
  { key: 'structure', label: '構造・輪郭', color: '#5c6bc0' },
  { key: 'opening',   label: '開口',       color: '#26a69a' },
  { key: 'equipment', label: '設備・機器', color: '#ef6c00' },
  { key: 'feature',   label: '造作・凹凸', color: '#8d6e63' },
];

App.TRADES = [
  { key: 'kaitai',   label: '解体' },
  { key: 'cross',    label: 'クロス' },
  { key: 'daiku',    label: '大工' },
  { key: 'yuka',     label: '床' },
  { key: 'tosou',    label: '塗装' },
  { key: 'denki',    label: '電気工事' },
  { key: 'suido',    label: '水道' },
  { key: 'gas',      label: 'ガス' },
  { key: 'kitchen',  label: 'キッチン' },
  { key: 'unit',     label: 'ユニット' },
  { key: 'toilet',   label: 'トイレ' },
  { key: 'repair',   label: 'リペア' },
  { key: 'cleaning', label: 'クリーニング' },
  { key: 'zakkou',   label: '雑工' },
];

App.CONDITIONS = ['残置', '撤去', '劣化', '新設', '既存維持', 'その他'];

App.MEASURE_TYPES = [
  { key: 'shinshin', label: '芯々' },
  { key: 'uchinori', label: '内法' },
];

App.DRAWING_TYPES = [
  { key: 'plan',      label: '平面図' },
  { key: 'elevation', label: '立面図' },
];

/* 写真への書き込み色パレット（依頼先タブの注釈で使用） */
App.ANNOT_COLORS = [
  { key: 'red',    value: '#e53935' },
  { key: 'blue',   value: '#1e88e5' },
  { key: 'green',  value: '#43a047' },
  { key: 'orange', value: '#fb8c00' },
  { key: 'black',  value: '#212121' },
  { key: 'white',  value: '#ffffff' },
];

App.catOf = function (key) {
  return App.CATEGORIES.find(function (c) { return c.key === key; }) || App.CATEGORIES[0];
};
App.tradeLabel = function (key) {
  var t = App.TRADES.find(function (t) { return t.key === key; });
  return t ? t.label : key;
};
App.measureLabel = function (key) {
  var m = App.MEASURE_TYPES.find(function (m) { return m.key === key; });
  return m ? m.label : '';
};
App.drawingTypeLabel = function (key) {
  var d = App.DRAWING_TYPES.find(function (d) { return d.key === key; });
  return d ? d.label : key;
};
