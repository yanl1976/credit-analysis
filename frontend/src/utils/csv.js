// CSV 下载：后端已带 UTF-8 BOM，Excel 直接打开不乱码
export function downloadCsv(filename, content) {
  const name = String(filename || 'export.csv').replace(/[\\/:*?"<>|]/g, '_');
  const blob = new Blob([content || ''], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
