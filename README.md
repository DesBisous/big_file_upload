![image](https://note.youdao.com/yws/api/personal/file/WEBf67f03df82fe1690968983fa24b3955f?method=download&shareKey=b56e81e7a62e533f3f692f75f5d3ea95)

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [大文件上传深入研究实现](#%E5%A4%A7%E6%96%87%E4%BB%B6%E4%B8%8A%E4%BC%A0%E6%B7%B1%E5%85%A5%E7%A0%94%E7%A9%B6%E5%AE%9E%E7%8E%B0)
  - [前言](#%E5%89%8D%E8%A8%80)
  - [思路](#%E6%80%9D%E8%B7%AF)
  - [知识点](#%E7%9F%A5%E8%AF%86%E7%82%B9)
  - [实现](#%E5%AE%9E%E7%8E%B0)
    - [Html Template](#html-template)
    - [Input Change Event](#input-change-event)
    - [文件切片](#%E6%96%87%E4%BB%B6%E5%88%87%E7%89%87)
    - [计算抽样 hash 值](#%E8%AE%A1%E7%AE%97%E6%8A%BD%E6%A0%B7-hash-%E5%80%BC)
    - [计算全量 hash 值](#%E8%AE%A1%E7%AE%97%E5%85%A8%E9%87%8F-hash-%E5%80%BC)
      - [web workder 线程处理](#web-workder-%E7%BA%BF%E7%A8%8B%E5%A4%84%E7%90%86)
      - [时间切片 requestIdleCallback 处理](#%E6%97%B6%E9%97%B4%E5%88%87%E7%89%87-requestidlecallback-%E5%A4%84%E7%90%86)
    - [http 请求并发控制](#http-%E8%AF%B7%E6%B1%82%E5%B9%B6%E5%8F%91%E6%8E%A7%E5%88%B6)
    - [http 请求取消 Api abort()](#http-%E8%AF%B7%E6%B1%82%E5%8F%96%E6%B6%88-api-abort)
    - [http 请求报错与重试](#http-%E8%AF%B7%E6%B1%82%E6%8A%A5%E9%94%99%E4%B8%8E%E9%87%8D%E8%AF%95)
    - [Node Koa2 Web 服务器搭建](#node-koa2-web-%E6%9C%8D%E5%8A%A1%E5%99%A8%E6%90%AD%E5%BB%BA)
    - [Web 服务器接收文件切片](#web-%E6%9C%8D%E5%8A%A1%E5%99%A8%E6%8E%A5%E6%94%B6%E6%96%87%E4%BB%B6%E5%88%87%E7%89%87)
    - [Web 服务器文件切片合并](#web-%E6%9C%8D%E5%8A%A1%E5%99%A8%E6%96%87%E4%BB%B6%E5%88%87%E7%89%87%E5%90%88%E5%B9%B6)
    - [Web 服务器文件切片定时清理 node-schedule](#web-%E6%9C%8D%E5%8A%A1%E5%99%A8%E6%96%87%E4%BB%B6%E5%88%87%E7%89%87%E5%AE%9A%E6%97%B6%E6%B8%85%E7%90%86-node-schedule)
  - [源码链接](#%E6%BA%90%E7%A0%81%E9%93%BE%E6%8E%A5)
  - [参考文献](#%E5%8F%82%E8%80%83%E6%96%87%E7%8C%AE)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# 大文件上传深入研究实现

## 前言

本案例实现了关于大文件上传的一系列问题和优化功能，这 Demo 的展示是基于几位大佬的文章总结出来的，几位大佬的引用文献会在结尾陈列。

项目实现效果如下(较为模糊~)：

<img style="width: 100%; height: auto" src="https://note.youdao.com/yws/api/personal/file/WEBe6362febba66c21f807864fffe7199fd?method=download&shareKey=836787fc0cc07a5ca645ab31e479fbe0"/>

文件碎片上传中可以发现会出现上传失败的问题，但会进行一个 3 次以内的重试功能，最终碎片上传完毕即可进行合并达到文件上传完毕效果

## 项目启动

前端启动：

直接进去根目录运行以下命令：

```
yarn run serve
or
npm runn serve
```

Web 服务启动：

进去`/server/`目录运行一下命令：

```
yarn run serve
or
npm runn serve
```

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
const SIZE = 2 * 1024 * 1024; // 切片大小
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

实际上文件上传到服务器最终会使用全量计算出来的 hash 作为命名保存下来（如果采用抽样 hash 来命名保存也是可以，就可以完全抛弃 全量计算 hash 的做法了，不过我这里为了测试或者说是折中了一下而已）；

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

由浏览器给我们分配剩余的可执行时间片(通过 requestIdleCallback 实现)，我们要按照约定在这个时间内执行完毕，并将控制权还给浏览器。

![image](https://note.youdao.com/yws/api/personal/file/WEB1e8d2c823dba3119c6e1274263e0e825?method=download&shareKey=6a8bc83482a309a4bb8717c982081f90)

**requestIdleCallback Api**

```
window.requestIdleCallback(
  callback: (dealine: IdleDeadline) => void,
  option?: {timeout: number} // 超时时间，防止一直不执行 callback 的一种优先级设置
)
```

如果游览器有可执行时间分配的时候，就会调用 `callback` 方法，并传入 `IdleDeadline` 对象。

`IdleDeadline` 的接口如下：

```
interface IdleDealine {
  didTimeout: boolean // 表示任务执行是否超过约定时间
  timeRemaining(): DOMHighResTimeStamp // 任务可供执行的剩余时间
}
```

`requestIdleCallback` 的意思是让浏览器在'有空'的时候就执行我们的回调，这个回调会传入一个期限，表示浏览器有多少时间供我们执行,在这个时间范围内执行。

** 那浏览器什么时候有空？**

游览器的时间按照一帧来算，浏览器在一帧内可能会做执行下列任务，而且它们的执行顺序基本是固定的:

- 处理用户输入事件
- Javascript 执行
- requestAnimation 调用
- 布局 Layout
- 绘制 Paint

![image](https://note.youdao.com/yws/api/personal/file/WEB2bf95a489ef12447ddff8eeca95d06c6?method=download&shareKey=69032179ce68378d756f522ffff345d3)

理想的一帧时间是 16ms (1000ms / 60)，如果浏览器处理完上述的任务(布局和绘制之后)，还有盈余时间，浏览器就会调用 requestIdleCallback 的回调。例如

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

还有的就是 `requestIdleCallback` 原则上是游览器出现了空闲时间才会进行回调的 Api，如下图所示的 idle period 区域：

![image](https://note.youdao.com/yws/api/personal/file/WEBa043cc154c57f866e094206b3957ead2?method=download&shareKey=4e6e34bc6ac4f0da6857e6fb0ff5df4e)

这会有一个问题，那就是如果一直未能分配时间给我们呢？这会导致任务被饿死，拿不到资源，可以设置一个超时时间，就是 `requestIdleCallback` 的第二个参数 `option?: {timeout: number}` 可以设置。

### http 请求并发控制

经过上述处理后，我们可以得到一个存储了文件碎片的数组 `fileChunkList`， 并且我们使用文件 hash 向后端发起请求判断是否已存在待上传文件的方法中 `verifyUploadWarp` 会返回两个字段 `shouldUpload, uploadedList`；

如果文件已存在则 `shouldUpload` 会是 `false`，否者为 `true`；
另外如果 `shouldUpload` 是 `true`，两一个字段 `uploadedList` 会返回该文件已上传的 文件碎片 列表，这些碎片表示已上传过了，就不用上传了，达到文件碎片`秒传`的效果;

`verifyUploadWarp` 方法如下：

```
async verifyUploadWarp(fileName, hash) {
  /**
   * 【验证是否文件已上传了】
   * 已上传
   *    shouldUpload 为 false
   * 未上传
   *    shouldUpload 为 true
   *    uploadedList 为 [切片1, 切片2, ..., 切片n] 已上传切片的地址文件名
   *    ["13717432cb479f2f51abce2ecb318c13-1.mp3"]
   */
  const res = await this.verifyUpload(fileName, hash);

  if (!res.success) {
    this.$message.error('上传失败！');
    return false;
  }

  const { shouldUpload, uploadedList } = res.data;

  if (!shouldUpload) {
    // 服务器已存在相同的文件了
    this.$message.success('秒传：上传成功');
    this.fakeUploadPercentage = 100;
    this.status = Status.wait;
    return false;
  }

  return { shouldUpload, uploadedList };
},
async verifyUpload(fileName, fileHash) {
  const { data } = await this.request({
    url: '/verify',
    headers: {
      'content-type': 'application/json',
    },
    data: JSON.stringify({
      fileName,
      fileHash,
    }),
  });
  return data;
},
```

以上就是验证文件在服务器的情况方法，至于后端如何做到的，后续会说明 `Node` 端的处理，这里大概有这前端逻辑认识即可。

这时候，我们做完验证操作后，就可进行文件上传了，前提是文件不存在服务器上情况；

首先，我们需要对文件碎片数组进行 `FormData` 封装，因为我们上传都采用 `new FormData` 方式上传：

```
// 上传切片，同时过滤已上传的切片
async uploadChunks(uploadedList = []) {
  const requestList = this.fileChunkList
    .filter(({ hash }) => !uploadedList.includes(hash)) // 过滤出未上传的切片进行上传
    .map(({ chunk, hash, index }) => {
      const formData = new FormData();
      formData.append('chunk', chunk); // 切片
      formData.append('hash', hash); // 切片 hash
      formData.append('fileName', this.container.file.name); // 文件名称
      formData.append('fileHash', this.container.hash); // 文件 hash
      return {
        formData,
        index,
        status: Status.wait, // 切片上传状态
        retryNum: 0, // 切片重试次数
      };
    });
```

组装成 `FormData` 数据数组后进行发起请求，由于我们这里需要进行请求数控制，每次发起请求数需要进行一个控制。

```diff
// 上传切片，同时过滤已上传的切片
async uploadChunks(uploadedList = []) {
  const requestList = this.fileChunkList
    .filter(({ hash }) => !uploadedList.includes(hash)) // 过滤出未上传的切片进行上传
    .map(({ chunk, hash, index }) => {
      const formData = new FormData();
      formData.append('chunk', chunk); // 切片
      formData.append('hash', hash); // 切片 hash
      formData.append('fileName', this.container.file.name); // 文件名称
      formData.append('fileHash', this.container.hash); // 文件 hash
      return {
        formData,
        index,
        status: Status.wait, // 切片上传状态
        retryNum: 0, // 切片重试次数
      };
    });
+ const limit = 4; // 限制并发数为 4
+ const res = await this.sendRequest(requestList, limit);
```

接下来我们看看 `sendRequest` 如何进行并发性控制

```
async sendRequest(requestList, limit) {
  return new Promise((resolve, reject) => {
    let max = limit;
    let count = 0; // 成功的数量
    let index = 0; // 索引
    const len = requestList.length;
    const start = () => {
      while (index < len && max > 0) {
        max--; // 占用通道

        const formData = requestList[index].formData;
        index++;

        this.request({
          url: '/upload',
          data: formData,
          onProgress: this.createProgressHandler(this.fileChunkList[index]),
        })
          .then(({ data }) => {
            max++; // 释放通道
            count++;
            if (count >= len) {
                resolve();
            } else {
                start();
            }
          })
      }
    };
    start();
  });
},
```

上述方法中 `sendRequest` 就是一个普通的 AJAX 请求，具体可看下一节，并且一并实现了请求取消功能。

从上述的代码中可以看到，控制请求的并发数，就是通过一个 `max` 通道进行管理的，当通道的可用数量为 0 的时候，则不会再次发起请求；

当请求中的 http 完成后，`max` 通道会放开一个 +1，并且进行下一个 `start()` 方法的调用，这样并发控制就简单的实现了。

### http 请求取消 Api abort()

这里涉及到文件上传的“暂停”和“恢复”的功能，下面说一说思路：

关于如何中断一个已发起请求，就可以使用到 `XMLHttpRequest` 自带的 Api `abort()` 方法了，不过我们一般在 `vue` 或者 `react` 中采用的 `npm ajax` 库，也有这功能，可以自行去查找。

我们发起文件碎片上传的时候，我们可以手段停止剩下文件碎片的发送，并且还可以使用 `abort()` 将正在上传的请求进行取消，这样就能达到了，文件上传暂停的效果；

暂停后，我们需要恢复上传，这又要如何处理呢，前面也说到，我们每次上传的时候都会调用 `verifyUploadWarp` 方法校验已上传的文件，该方法会返回已上传的文件碎片列表，对此，这里我们点击恢复按钮的时候，我们就可以找到当前文件的哪一些文件碎片没有上传的，然后从没有上传的文件碎片重新开始上传，这样不就达到恢复上传的效果了吗。

下面看看实现：

**Html Template**

```diff
<template>
  <div id="app">
    <div>
      <input type="file" :disabled="status !== Status.wait" @change="handleFileChange" />
      <el-button type="primary" :disabled="uploadDisabled" @click="handleUpload">上传</el-button>
+     <el-button @click="handleResume">恢复</el-button>
+     <el-button @click="handlePause" >暂停</el-button>
    </div>
  </div>
</template>
```

**JavaScript**
发送请求的方法调用，我们需要加一个字段 `requestingList`，这个字段实现在 `data` 中进行了定义，这是用来存储正在上传的 `HTTP` 请求对象，用于后续暂停时的使用

```diff
async sendRequest(requestList, limit) {
  return new Promise((resolve, reject) => {
        ...
        this.request({
          url: '/upload',
          data: formData,
          onProgress: this.createProgressHandler(this.fileChunkList[index]),
+         requestingList: this.requestingList,
        })
        ..。
  });
},
+ request({
+       url,
+       method = "post",
+       data,
+       headers = {},
+       onProgress = (e) => e,
+       requestingList,
+     }) {
+       return new Promise((resolve, reject) => {
+         const xhr = new XMLHttpRequest();
+         xhr.upload.onprogress = onProgress;
+         xhr.open(method, baseUrl + url);
+         Object.keys(headers).forEach((key) =>
+           xhr.setRequestHeader(key, headers[key])
+         );
+         xhr.send(data);
+         xhr.onload = (e) => {
+           // 将请求成功的 xhr 从列表中删除
+           if (requestingList) {
+             const xhrIndex = requestingList.findIndex((item) => item === xhr);
+             requestingList.splice(xhrIndex, 1);
+           }
+           if (e.target.status === 200) {
+             resolve({ data: JSON.parse(e.target.response) });
+           } else {
+             reject(new Error(e.target.status));
+           }
+         };
+         // 暴露当前 xhr 给外部
+         requestingList?.push(xhr);
+       });
+     },
+   },
+ };
```

这就是 `XMLHttpRequest` 发起请求的方法封装了，可以看到，每次发起请求后会将 `xhr` 对象存储在 `requestingList` 数组中，之后如果当前请求对象完成的话。又会进行移除`requestingList.splice(xhrIndex, 1);`

接下来`暂停`方法如下：

```
handlePause() {
  this.status = Status.pause;
  this.resetData();
},
resetData() {
  this.requestingList.forEach((xhr) => xhr?.abort()); // 取消请求
  this.requestingList = [];
  if (this.container.worker) {
    // 关闭线程接收消息监听
    // 这里的作用是为了能够暂停对文件 hash 的进度，使得停下来
    this.container.worker.onmessage = null;
  }
},
```

然后就是`恢复`方法：

```
 async handleResume() {
  this.status = Status.uploading;
  const data = await this.verifyUpload(
    this.container.file.name,
    this.container.hash
  );

  const { shouldUpload, uploadedList } = data.data;
  if (shouldUpload) {
    await this.uploadChunks(uploadedList);
  }
},
```

`恢复`的功能其实就是重新进行上传文件的方法。

### http 请求报错与重试

试想一下，如果我们上传文件切片的时候，万一某一个文件切片上传失败了，那我们发起文件合并的请求信号给后端的时候，后端是没办法合成的，就算合成这些碎片，也会因为遗漏了，而无法成功合成。(发起文件合并的请求信号的方法自行看源代码了，比较简单)

因为会有失败的可能性，为此我们可以给文件碎片进行重试的功能，但是也不能无限重试下去，这里我设定了重试次数最多三次。

最后如果我们已完成的文件碎片上传等于待上传文件碎片的数量，才能发起合并请求。

我们来改造一下`sendRequest` 方法：

```diff
async sendRequest(requestList, limit) {
  return new Promise((resolve, reject) => {
    let max = limit;
    let count = 0; // 成功的数量
-   let index = 0; // 索引
    const len = requestList.length;
    const start = () => {
-     while (index < len && max > 0) {
+     while (count < len && max > 0) {
        max--; // 占用通道

+       // 任务不能仅仅累加获取，而是要根据状态
+       // wait 和 error 并且 重试次数小于 3 次的可以发出请求 方便重试
+       const requestData = requestList.find(
+         (item) =>
+           item.status === Status.wait ||
+           (item.status === Status.error && item.retryNum <= 2)
+       );

+       // 找不到有效待上传切块了，
+       // 这时候可能还有并发切块在上传中 count 未能达到 len，
+       // 所以这时候通过 max 通道不再开放 ++ 控制，进而减少通道
+       if (!requestData) continue;
+       // 更改状态为：uploading
+       requestData.status = Status.uploading;

-       const formData = requestList[index].formData;
+       const formData = requestData.formData;
-       index++;

       this.request({
          url: '/upload',
          data: formData,
-         onProgress: this.createProgressHandler(this.fileChunkList[index]),
+         onProgress: this.createProgressHandler(this.fileChunkList[requestData.index]),
          requestingList: this.requestingList,
        })
          .then(({ data }) => {
            max++; // 释放通道
            count++;
-           if (count >= len) {
-               resolve();
-           } else {
-               start();
-           }
+           start();
          })
+         .catch((err) => {
+           max++; // 释放通道
+           requestData.status = Status.error; // 修改状态为报错状态
+           this.fileChunkList[requestData.index].percentage = 0; // 重置进度条
+           if (typeof requestData["retryNum"] !== "number") {
+             requestData["retryNum"] = 0;
+           }

+           // 次数累加
+           requestData["retryNum"] += 1;

+           // 达到 3 次报错
+           if (requestData["retryNum"] > 2) {
+             count++; // 把当前切块 3 次失败后，当做是成功了，不再重试发送了
+             this.fileChunkList[requestData.index].percentage = -1; // 更改上传失败进度条
+           }

+           start(); // 触发下一个有效切块上传
+         });
     }
    };
    start();
  });
},
```

### Node Koa2 Web 服务器搭建

说到这里，关于前端方面的知识点就讲的才不多了，接下来就是 `Node` 后端的处理了；

后端，这里就是使用了 `koa2` 来实现 Web 服务器：

```
import Koa from 'koa';
import logger from 'koa-logger';
import bodyParser from 'koa-bodyparser';
import cors from 'koa2-cors';
import corsConfig from './corsConfig';
import routes from './router'; // koa-router

const app = new Koa();
const isProduction = process.env.NODE_ENV !== 'development';

// 日志
!isProduction ? app.use(logger()) : '';

// CORS 跨域配置
app.use(cors(corsConfig));

// koa-bodyparser
app.use(bodyParser());

// add router middleware:
app.use(routes());

app.listen(9100);
console.log('koa 服务启动成功!');
```

这里展示了整体的后端架构，主要用了一下几个库，至于每一个库的使用封装内部实现就不在这展示了，可以去看后面`源码`，这里粗略说明一下各个库的作用：

> koa-logger 日志输出
>
> koa-bodyparser 接受 Post 请求的 data 数据，因为 koa2 未能接受 Post 请求的 data 数据
>
> koa2-cors 这个适用于对服务端的配置，比如：
>
> - 表示接受任意域名的请求;
> - 是否接受凭证 cookie、
> - 允许的请求方法 ['GET', 'POST', 'PUT', 'DELETE'];
> - 允许的请求头 ['Content-Type', 'Authorization', 'Accept', 'X-User-Token']
> - 等等
>
> koa-router 路由配置，能够更方便的构建请求接口名称

### Web 服务器接收文件切片

文件切片处理，使用了一个 `multiparty` 库，它能够将前端上传的 `FormData` 对象中的 `File` 和普通字段区分开了，以便更好地处理。

对于文件操作，这里使用 `fs-extra` 代替 `Node` 自带的 `fs` 库，有这更好的兼容性和 API。

下面就直接上代码，看注释吧：

```
const extractExt = fileName => fileName.slice(fileName.lastIndexOf('.'), fileName.length); // 提取后缀名
const UPLOAD_DIR = path.resolve(__dirname, '..', 'target'); // 大文件存储目录

// 处理切片
export const handleFormData = async ctx => {
  const req = ctx.req;
  const multipart = new multiparty.Form();

  multipart.on('error', function(err) {
    console.log('Emultipart 解析失败: ' + err.stack);
  });

  return new Promise(resolve => {
    multipart.parse(req, async (err, fields, files) => {
      // 模拟报错
      if (Math.random() < 0.2) {
        console.log(fields.hash, '500');
        return resolve({
          code: 500,
        });
      }
      if (err) {
        return resolve({
          code: 500,
        });
      }
      const [chunk] = files.chunk; // 切面文件
      const [hash] = fields.hash; // 切片文件 hash 值
      const [fileHash] = fields.fileHash; // 文件 hash 值
      const [fileName] = fields.fileName; // 文件名
      const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${extractExt(fileName)}`);
      const chunkDir = path.resolve(UPLOAD_DIR, fileHash);

      // 文件存在直接返回
      if (fse.existsSync(filePath)) {
        return resolve({
          code: 200,
        });
      }

      // 切片目录不存在，创建切片目录
      if (!fse.existsSync(chunkDir)) {
        await fse.mkdirs(chunkDir);
      }
      // fs-extra 专用方法，类似 fs.rename 并且跨平台
      // fs-extra 的 rename 方法 windows 平台会有权限问题
      // https://github.com/meteor/meteor/issues/7852#issuecomment-255767835
      /**
       * 这里的 chunk.path 是 koa-bodyparser 库对上传的文件的系统临时存放的地址
       * 存放目录为 '/var/folders/g5/x7gcn7492qb3d6gbw1z6qjw00000gn/T'
       * 这个目录是 koa-bodyparser 通过使用 node 的 Api os.tmpdir() 进行获取的
       * 对于这个系统临时存放地址也可以进行更改，通过 koa-bodyparser 配置时的参数
       * */
      await fse.move(chunk.path, path.resolve(chunkDir, hash));
      return resolve({
        code: 200,
      });
    });
  });
};
```

处理文件碎片上，可以看到我们上传文件的时候，会先保存在内存中，然后我们使用 `fse.move` 将内容中的文件移动到存放文件的目录，并且进行重命名。

### Web 服务器文件切片合并

前端发起合并操作的时候，后端只需要将对应 `hash` 的碎片进行合并即可。具体思路：

1. 我们使用 `fse.readdir` 读取对应 hash 目录，将里面的文件碎片文件读取获取搜有地址
2. 将文件碎片地址进行遍历，然后使用 `fse.createReadStream` 进行读取
3. 通过使用 `fse.createReadStream` 创建读取对象通过 `pipe` 管道对接到写入流 `fse.createWriteStream`

这里需要注意的是有两点：

1. 我们读取的文件碎片目录地址，可能会顺序不对，我们需要进行排序，因为文件碎片在完成文件中是有属于它的位置的。
2. 再者，我们读取文件碎片的时候使用的是 `fse.createReadStream`，这个是异步的，所以如果我们遍历读取排序后的碎片文件，到最后读取完毕写入的文件流中的时候直接 `Push` 方式的话肯定顺序是错乱的，所以我们需要在写入文件流的时候指定 `start` 和 `end` 位置。

```
const extractExt = fileName => fileName.slice(fileName.lastIndexOf('.'), fileName.length); // 提取后缀名
const UPLOAD_DIR = path.resolve(__dirname, '..', 'target'); // 大文件存储目录

// 合并切片
export const handleMerge = async ctx => {
  const req = ctx.request;
  const data = req.body;
  const { fileHash, fileName, size } = data;
  const ext = extractExt(fileName);
  const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`); // 获取组装文件输出地址
  await mergeFileChunk(filePath, fileHash, size);
  return {
    code: 200,
    data: null,
    message: '上传成功',
    success: true,
  };
};
```

### Web 服务器文件切片定时清理 node-schedule

文件碎片定期清理，当我们上传文件的时候，都是进行切分上传碎片的，如果未进行合并的话，上传到一半就不继续了，后续会存在很多的文件碎片遗留在服务器，这时候就需要一个清理步骤了。

这里定时模块，所使用的的是 `node-schedule` [API](https://www.npmjs.com/package/node-schedule)

```
const UPLOAD_DIR = path.resolve(__dirname, '..', 'target'); // 大文件存储目录

// *    *    *    *    *    *
// ┬    ┬    ┬    ┬    ┬    ┬
// │    │    │    │    │    │
// │    │    │    │    │    └ day of week (0 - 7) (0 or 7 is Sun)
// │    │    │    │    └───── month (1 - 12)
// │    │    │    └────────── day of month (1 - 31)
// │    │    └─────────────── hour (0 - 23)
// │    └──────────────────── minute (0 - 59)
// └───────────────────────── second (0 - 59, OPTIONAL)
export default function _schedule() {
  // '42 * * * *' 每小时的 42 分钟的时候执行
  // */5 * * * *  每五分钟

  // 每30分钟
  schedule.scheduleJob('*/30 * * * *', function() {
    console.log('开始扫描');
    scan(UPLOAD_DIR);
  });
}
```

这里具体的删除文件操作，可以看后面源码链接，注释中可清除的看出，想要定是多久如何进行配置了，非常方便。

## 源码链接

[源码](https://github.com/DesBisous/big_file_upload)

## 参考文献

- [字节跳动面试官：请你实现一个大文件上传和断点续传](https://juejin.im/post/6844904046436843527)
- [字节跳动面试官，我也实现了大文件上传和断点续传](https://juejin.im/post/6844904055819468808#heading-9)
- [这可能是最通俗的 React Fiber(时间分片) 打开方式](https://juejin.im/post/6844903975112671239)
