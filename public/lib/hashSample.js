// self 就是 window
self.importScripts('./spark-md5.min.js'); // 导入脚本

// 生成文件 hash

self.onmessage = e => {
  const { file } = e.data;
  const spark = new self.SparkMD5.ArrayBuffer();
  const reader = new FileReader();
  const size = file.size;
  const offset = 2 * 1024 * 1024;
  const fileChunkList = [];
  let cur = offset;

  // 读取第一块完整的切片内容
  fileChunkList.push(file.slice(0, cur));

  while (cur < size) {
    if (cur + offset >= size) {
      fileChunkList.push(file.slice(cur, size));
    } else {
      const mid = (cur + offset) / 2;
      const end = cur + offset;
      fileChunkList.push(file.slice(cur, cur + 2));
      fileChunkList.push(file.slice(mid, mid + 2));
      fileChunkList.push(file.slice(end - 2, end));
      self.postMessage({ percentage: cur / size });
    }
    cur += offset;
  }
  // 拼接
  reader.readAsArrayBuffer(new Blob(fileChunkList));
  reader.onload = e => {
    spark.append(e.target.result);
    self.postMessage({
      percentage: 100,
      hash: spark.end(), // 结束 ArrayBuffer 流，获取计算后的文件 md5
    });
  };
};
