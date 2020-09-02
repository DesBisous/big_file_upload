<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

**Table of Contents** _generated with [DocToc](https://github.com/thlorenz/doctoc)_

- [大文件上传深入研究实现](#%E5%A4%A7%E6%96%87%E4%BB%B6%E4%B8%8A%E4%BC%A0%E6%B7%B1%E5%85%A5%E7%A0%94%E7%A9%B6%E5%AE%9E%E7%8E%B0)
  - [前言](#%E5%89%8D%E8%A8%80)
  - [思路](#%E6%80%9D%E8%B7%AF)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# 大文件上传深入研究实现

## 前言

本案例实现了关于大文件上传的一系列问题和优化功能，这 Demo 的展示是基于几位大佬的文章总结出来的，几位大佬的引用文献会在结尾陈列。

## 思路

本文 Demo 架构

前端：vue 2.x + elementUi 为基础搭建的

后端：Node + Koa2 等库为基础搭建

对于大文件上传考虑到上传时间太久、超出游览器响应时间、提高上传效率、优化上传用户体验等问题进行了深入探讨，以下初略罗列各个知识点的实现思路：

1. 大文件上传对文件本身进行了文件流内容 Blob 的分割，采用了`Blob.prototype.slice`实现大文件的上传切分为多个小文件的上传；

2. 为了实现大文件上传能否做到“秒传”、“辨别是否已存在”、“文件切片的秒传”等功能，需要对大文件进行计算 hash 唯一标识，通过使用 web-workder 开启游览器线程来计算文件 hash ，防止阻塞 UI 渲染（ 另外也采用 React Fiber 所用的时间分片思想方式 requestIdleCallback Api 来计算，React 是自己另外实现了 ）；

3. “上传暂停/恢复”功能采用 `XMLHttpRequest` 请求带有的 `abort()` 方法进行请求的取消来实现（ axios 也有相对应的功能 ）

4. “判断文件是否已存在”，在性能上可以通过计算抽样 hash 来大大缩短大文件全量计算 hash 的时间，使用这个抽样 hash 向服务器确认是否已存在文件，而达到“秒传”的功能，抽样 hash 的作用在于牺牲一点点的识别率来换取时间，这个需要权衡，但本人认为还是不错的；

5. 大文件切分为小文件后，通过设置一个上传通道限制，实现控制 “并发上传数” 来防止一次性过多的 HTTP 请求而卡死游览器；

6. 文件切片上传采用请求 catch 捕获方式，来对上传失败的内容进行重试，重试三次后再失败就进行放弃；

7. 后端采用 `Node`、`Koa2`、`koa-bodyparser`、`koa-router`、`koa2-cors` 等来实现上传服务器；

8. 对于文件服务器过期的文件切片开启定时器清理，采用了 `node-schedule` 来实现；

## 知识点

> - 文件切片( Blob.prototype.slice )
> - web-workder 线程使用
> - 时间切片 requestIdleCallback
> - 计算文件抽样 hash
> - 计算文件全量 hash
> - http 请求并发控制
> - http 请求取消 Api `abort()`
> - http 请求报错与重试
> - Node Koa2 Web 服务器搭建
> - Web 服务器接收文件切片 + 文件切片合并
> - Web 服务器文件切片定时清理 `node-schedule`

## 实现

### Html Template

```
<template>
  <div id="app">
    <div>
      <input type="file" :disabled="status !== Status.wait" @change="handleFileChange" />
      <el-button type="primary" :disabled="uploadDisabled" @click="handleUpload">上传</el-button>
    </div>
  </div>
</template>
```

这里就是一个基础的上传文件控件，`input[type='file']` 和 `button` 组件。

这里对 `input` 和 `button` 进行了简单的 `disabled` 状态控制。

### Input Change Event

`input` 选择文件后需要对内容进行判断和存储，并且做一些初始化工作。

```
...
data: () => ({
  container: {
    file: null, // 文件对象
    hash: '', // 文件 hash 标识
    hashSample: '', // 抽样文件 hash 标识
  },
}),
...
handleFileChange(e) {
  const [file] = e.target.files;
  if (!file) return;
  this.container.file = file;
  // 初始化状态
  this.container.hash = '';
  this.container.hashSample = '';
}
```

### 文件切片

在选择待上传文件后，触发 `button` 触发上传事件，首先就需要对文件进行文件切片分割，这里所使用的的核心 Api 就是 `Blob.prototype.slice`，这个 Api 和数组的 `slice` 方法类似，调用文件的 `slice` 就可以进行分割返回 **原文件的某一段切片内容**。

```
const SIZE = 10 * 1024 * 1024; // 切片大小
...
async handleUpload() {
  if (!this.container.file) return;
  // 切分文件块
  const fileChunkList = this.createFileChunk(this.container.file);
},
// 生成文件切片
createFileChunk(file, size = SIZE) {
  const fileChunkList = [];
  let cur = 0;
  while (cur < file.size) {
    fileChunkList.push({ file: file.slice(cur, cur + size) });
    cur += size;
  }
  return fileChunkList;
},
```

通过 `createFileChunk` 方法后，得到一个根据常量 `SIZE` 大小切分过后的 File Chunk List，每一个元素都是一个 `Blob` 数据。

### 计算抽样 hash 值

计算抽样 hash 值，在 Deom 中，主要的作用就是判断待上传文件是否已经存在于服务器上了，如果存在即可不用再次上传，而给用户展示的体验就是一种“秒传”的感受。

计算抽样 hash 值的思路如下：

> 1. 按照常亮 `SIZE` 将文件分成一个个切片
> 2. 取第一个和最后一个切片的全部内容，其他切片取各个块的前中后 2 个字节
> 3. 之后将这些所有内容合并起来，放入到一个数组中存储 `fileChunkList`
> 4. 再通过 `new Blob(fileChunkList)` 将抽样文件 `Blob` 数组转成 `Blob` 对象让文件读取流进行读取
> 5. 最后通过第三方库 `spark-md5.min.js` 将抽样文件流进行 md5 转换生成最终得到的抽样 hash

这种抽样 hash 的计算时间能够大大缩短，但是带来的副作用也是存在的，那就是识别精准度会丢失一些，举个栗子：

( 全量计算 hash 后面会讲，这里先看看两个的差异 )

> - A 文件，计算出来：
>   - 抽样 hash：77479549034e6c4374bbadbf983f9dc1
>   - 全量 hash：6440273f559d686dc40fc13bff086522
>
> A 文件，这一个结果永远都不会变，一直都是不匹配的
>
> - B 文件，计算出来：
>   - 抽样 877f39ad698306357dce1531e6185922
>   - 全量 877f39ad698306357dce1531e6185922
>
> B 文件，这一个结果永远都不会变，一直都是匹配的

实际上文件上传到服务器最终会使用全量计算出来的 hash 作为命名保存下来；

所以使用抽样 hash 去服务器询问,如果服务器对于待上传文件不存在则肯定不存在；

但如果已存在待上传文件，会有概率误判，而且如果误判了，这会一直产生误判的结果因为计算 hash 产生的结果值是不会发生变化的；

对于这一点所以需要使用全量 hash 再次确认，如果使用了抽样 hash 去判断在大概率上是能够直接判断已上传文件，并做到快速“秒传”的功能**( 这一点上的加强秒传的速度，牺牲一点点的识别率来换取时间 )**，若有犹豫者也可以不采用。

```diff
...
async handleUpload() {
  if (!this.container.file) return;

+ this.container.hashSample = await this.calculateHashSample(this.container.file);

+ //【验证是否文件已上传了】
+ let data = await this.verifyUploadWarp(this.container.file.name, this.container.hashSample);
+ // 获取到的 data 标识可以判断是否已存在待上传文件了
+ if (!data) return; // 标识已存在“秒传”

  // 切分文件块
  const fileChunkList = this.createFileChunk(this.container.file);
},

+ // 生成文件抽样 hash（web-worker）
+ calculateHashSample(file) {
+   return new Promise(resolve => {
+     this.container.worker = new Worker('/lib/hashSample.js');
+     this.container.worker.postMessage({ file });
+     this.container.worker.onmessage = e => {
+       const { percentage, hash } = e.data;
+       this.hashSamplePercentage = percentage;
+       if (hash) {
+         // 关闭 worker 线程，线程如果不关闭，则会一直在后台运行着，这里在 worker 内部关闭了
+         // this.container.worker.terminate();
+         resolve(hash);
+       }
+     };
+   });
+ },
...
```

计算 hash 采用的是 `spark-md5.min.js` 第三方库，并且防止计算过程中会阻塞用户交互操作、渲染性能、掉帧问题，采用了 web workder 开启线程处理

```
// hashSample.js

self.importScripts('./spark-md5.min.js'); // 导入脚本

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
```

### 计算全量 hash 值

计算全量 hash 值所使用的基本 Api 和上面的抽样 hash 是类似的，这里计算全量 hash 的时候将用到前面进行文件切分后所得到的 `fileChunkList` 切块数组进行计算。

```diff
...
async handleUpload() {
  if (!this.container.file) return;

  this.container.hashSample = await this.calculateHashSample(this.container.file);

  //【验证是否文件已上传了】
  let data = await this.verifyUploadWarp(this.container.file.name, this.container.hashSample);
  // 获取到的 data 标识可以判断是否已存在待上传文件了
  if (!data) return; // 标识已存在“秒传”

  // 切分文件块
  const fileChunkList = this.createFileChunk(this.container.file);

+ // 计算全量 hash
+ this.container.hash = await this.calculateHash(fileChunkList);

+ //【验证是否文件已上传了】
+ data = await this.verifyUploadWarp(this.container.file.name, this.container.hash);
},

+ // 生成文件 hash（web-worker）
+ calculateHash(fileChunkList) {
+   return new Promise(resolve => {
+   this.container.worker = new Worker('/lib/hash.js');
+   this.container.worker.postMessage({ fileChunkList });
+   this.container.worker.onmessage = e => {
+     const { percentage, hash } = e.data;
+     this.hashPercentage = percentage;
+     if (hash) {
+       // this.container.worker.terminate();
+       resolve(hash);
+     }
+   };
+  });
+ },
...
```

这里计算 hash 可以使用上面计算抽样 hash 一样，使用 web workder 开启线程处理，另外也可以采用 requestIdleCallback 利用游览器空闲时间的时候去处理计算 hash。

#### web workder 线程处理

```
// hash.js
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
```

#### 时间切片 requestIdleCallback 处理

```diff
...
async handleUpload() {

// 计算全量 hash
- this.container.hash = await this.calculateHash(fileChunkList);
+ if (!window.requestIdleCallback) {
+   this.container.hash = await this.calculateHash(fileChunkList);
+ } else {
+   this.container.hash = await this.calculateHashIdle(fileChunkList);
+ }

...

// 生成文件 hash（web-worker）
calculateHash(fileChunkList) {
  return new Promise(resolve => {
    this.container.worker = new Worker('/lib/hash.js');
    this.container.worker.postMessage({ fileChunkList });
    this.container.worker.onmessage = e => {
      const { percentage, hash } = e.data;
      this.hashPercentage = percentage;
      if (hash) {
        // this.container.worker.terminate();
        resolve(hash);
      }
    };
  });
},
+ // 通过 window.requestIdleCallback 来解决阻塞 UI 问题，该函数能够利用游览器空闲时间执行
+ calculateHashIdle(fileChunkList) {
+   return new Promise(resolve => {
+     const spark = new SparkMD5.ArrayBuffer();
+     const chunkProportion = 100 / fileChunkList.length;
+     let count = 0;
+     const appendToSpark = async file => {
+       return new Promise(resolve => {
+         const reader = new FileReader();
+         reader.readAsArrayBuffer(file);
+         reader.onload = e => {
+           spark.append(e.target.result);
+           resolve();
+         };
+       });
+     };
+     const loadNext = async deadline => {
+       if (count < fileChunkList.length && deadline.timeRemaining() > 1) {
+         await appendToSpark(fileChunkList[count].file);
+         if (count === fileChunkList.length - 1) {
+           this.hashPercentage = 100;
+           resolve(spark.end()); // 结束 ArrayBuffer 流，获取计算后的文件 md5
+         } else {
+           this.hashPercentage += chunkProportion;
+           window.requestIdleCallback(loadNext);
+         }
+         count++;
+       }
+     };
+     window.requestIdleCallback(loadNext);
+   });
+ },
...
```

最后需要注意的是：

`requestIdleCallback` 目前该 Api 只有 Chrome 支持，对于该 API 在 React Fiber 中也是用了该思想，不过的是，React 为了兼容性，它利用 MessageChannel 模拟将回调延迟到'绘制操作'之后执行([链接](https://github.com/facebook/react/blob/master/packages/scheduler/src/forks/SchedulerHostConfig.default.js))

还有的就是 `requestIdleCallback` 原则上是游览器出现了空闲时间才会进行回调的 Api，这会有一个问题，那就是如果一直未能分配时间给我们呢？这会导致任务被饿死，拿不到资源，可以设置一个超时时间，就是 `requestIdleCallback` 的第二个参数 `option?: {timeout: number}` 可以设置。

## 参考文献
