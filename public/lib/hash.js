// self 就是 window
self.importScripts('./spark-md5.min.js'); // 导入脚本

// 生成文件 hash

self.onmessage = e => {
  const { fileChunkList } = e.data;
  const spark = new self.SparkMD5.ArrayBuffer();
  let percentage = 0;
  let count = 0;
  const loadNext = index => {
    const reader = new FileReader();
    reader.readAsArrayBuffer(fileChunkList[index].file);
    reader.onload = e => {
      count++;
      spark.append(e.target.result);
      if (count === fileChunkList.length) {
        self.postMessage({
          percentage: 100,
          hash: spark.end(), // 结束 ArrayBuffer 流，获取计算后的文件 md5
        });
        self.close(); // 关闭 worker 线程，线程如果不关闭，则会一直在后台运行着，
      } else {
        percentage += 100 / fileChunkList.length;
        self.postMessage({
          percentage,
        });
        loadNext(count);
      }
    };
  };
  loadNext(0);
};
