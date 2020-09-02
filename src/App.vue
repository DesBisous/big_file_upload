<template>
  <div id="app">
    <div>
      <input type="file" :disabled="status !== Status.wait" @change="handleFileChange" />
      <el-button type="primary" :disabled="uploadDisabled" @click="handleUpload">上传</el-button>
      <el-button v-if="status === Status.pause" @click="handleResume">恢复</el-button>
      <el-button
        v-else
        :disabled="status !== Status.uploading || !container.hash"
        @click="handlePause"
        >暂停</el-button
      >
    </div>
    <div>
      <br />
      <div>计算文件抽样 hashSample</div>
      <el-progress :percentage="getHashSamplePercentage"></el-progress>
      <div>计算文件 hash</div>
      <el-progress :percentage="getHashPercentage"></el-progress>
      <div>总进度</div>
      <el-progress :percentage="fakeUploadPercentage"></el-progress>
    </div>
    <div>
      <br />
      <div>方块进度条</div>
      <br />
      <div class="cube-container" :style="{ width: cubeWidth + 'px' }">
        <div class="cube" v-for="chunk in fileChunkList" :key="chunk.hash">
          <div
            :class="{
              uploading: chunk.percentage > 0 && chunk.percentage < 100,
              success: chunk.percentage === 100,
              error: chunk.percentage === -1,
            }"
            :style="{ height: chunk.percentage === -1 ? 100 : chunk.percentage + '%' }"
          >
            <i
              v-if="chunk.percentage > 0 && chunk.percentage < 100"
              class="el-icon-loading"
              style="color:#F56C6C;"
            />
          </div>
        </div>
      </div>
    </div>
    <div>
      <br />
      <div>条形进度条</div>
      <el-table :data="fileChunkList">
        <el-table-column prop="hash" label="切片hash" align="center"></el-table-column>
        <el-table-column label="大小(KB)" align="center" width="120">
          <template v-slot="{ row }">{{ row.size | transformByte }}</template>
        </el-table-column>
        <el-table-column label="进度" align="center">
          <template v-slot="{ row }">
            <el-progress
              :percentage="row.percentage > -1 ? row.percentage : 0"
              color="#909399"
            ></el-progress>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script>
import SparkMD5 from 'spark-md5';

const SIZE = 1 * 1024 * 1024; // 切片大小
const Status = {
  wait: 'wait',
  pause: 'pause',
  uploading: 'uploading',
  error: 'error',
  done: 'done',
};
const baseUrl = 'http://localhost:9100';

export default {
  name: 'App',
  data: () => ({
    Status,
    container: {
      file: null, // 文件对象
      hash: '', // 文件 hash 标识
      hashSample: '', // 抽样文件 hash 标识
      worker: null, // 线程对象
    },
    fileChunkList: [],
    status: Status.wait,
    requestingList: [], // 保存着正在请求的 ajax 对象
    hashPercentage: 0, // 对文件进行 hash 的进度
    hashSamplePercentage: 0, // 对文件抽样进行 hash 的进度
    // 当暂停时会取消 xhr 导致进度条后退
    // 为了避免这种情况，需要定义一个假的进度条
    fakeUploadPercentage: 0,
  }),
  computed: {
    cubeWidth() {
      // // 方块进度条尽可能的正方形 切片的数量平方根向上取整 控制进度条的宽度
      // 9 个方格按照 一个方格边长为 1，则 9个方各 的宽就是 Math.sqrt( 9 )
      // 使用 Math.ceil 向上取整，保证宽度满足横向方格所需的宽度，多出的一点不够一个方格则会换行
      // 16 是因为 一个方格设置的宽高为 14px ，加上 boder 为 1px ，所以边长为 16
      return Math.ceil(Math.sqrt(this.fileChunkList.length)) * 16;
    },
    uploadDisabled() {
      return !this.container.file || [Status.pause, Status.uploading].includes(this.status);
    },
    uploadPercentage() {
      if (!this.container.file || !this.fileChunkList.length) return 0;
      const loaded = this.fileChunkList
        .map(item => item.size * item.percentage)
        .reduce((acc, cur) => acc + cur);
      return parseInt((loaded / this.container.file.size).toFixed(2));
    },
    getHashSamplePercentage() {
      return Number(parseFloat(this.hashSamplePercentage).toFixed(2));
    },
    getHashPercentage() {
      return Number(parseFloat(this.hashPercentage).toFixed(2));
    },
  },
  filters: {
    transformByte(val) {
      return Number((val / 1024).toFixed(0));
    },
  },
  watch: {
    uploadPercentage(now) {
      if (now > this.fakeUploadPercentage) {
        this.fakeUploadPercentage = now;
      }
    },
  },
  methods: {
    handlePause() {
      this.status = Status.pause;
      this.resetData();
    },
    resetData() {
      this.requestingList.forEach(xhr => xhr?.abort()); // 取消请求
      this.requestingList = [];
      if (this.container.worker) {
        // 关闭线程接收消息监听
        // 这里的作用是为了能够暂停对文件 hash 的进度，使得停下来
        this.container.worker.onmessage = null;
      }
    },
    async handleResume() {
      this.status = Status.uploading;
      const data = await this.verifyUpload(this.container.file.name, this.container.hash);

      const { shouldUpload, uploadedList } = data.data;
      if (shouldUpload) {
        await this.uploadChunks(uploadedList);
      }
    },
    handleFileChange(e) {
      const [file] = e.target.files;
      if (!file) return;
      this.container.file = file;
      // 初始化状态
      this.container.hash = '';
      this.container.hashSample = '';
      this.container.worker = null;
      this.fileChunkList = [];
      (this.status = Status.wait), (this.hashPercentage = 0); // 对文件进行 hash 的进度
      this.hashSamplePercentage = 0; // 对文件抽样进行 hash 的进度
      this.fakeUploadPercentage = 0;
      this.requestingList = []; // 保存着正在请求的 ajax 对象
    },

    async handleUpload() {
      if (!this.container.file) return;
      /**
       * 抽样文件 hash 能够很快的计算出来，但抽样 hash 和 全量 hash 可能会产生误差
       * 比如：
       *  A 文件，计算出来：
       *    抽样 hash：77479549034e6c4374bbadbf983f9dc1
       *    全量 hash：6440273f559d686dc40fc13bff086522
       *  A 文件，这一个结果永远都不会变，一直都是不匹配的
       *  B 文件，计算出来：
       *    抽样 877f39ad698306357dce1531e6185922
       *    全量 877f39ad698306357dce1531e6185922
       *  B 文件，这一个结果永远都不会变，一直都是匹配的
       *
       *  所以使用抽样 hash 去服务器询问,如果不存在则需要使用全量 hash 再次确认,
       *  否者不用(这一点上的加强秒传的速度)
       */
      this.container.hashSample = await this.calculateHashSample(this.container.file);

      /**
       * 【验证是否文件已上传了】
       */
      let data = await this.verifyUploadWarp(this.container.file.name, this.container.hashSample);
      if (!data) return;

      // 切分文件块
      const fileChunkList = this.createFileChunk(this.container.file);

      // 计算全量 hash
      this.container.hash = await this.calculateHash(fileChunkList);
      /*if (!window.requestIdleCallback) {
        this.container.hash = await this.calculateHash(fileChunkList);
      } else {
        this.container.hash = await this.calculateHashIdle(fileChunkList);
      }*/

      /**
       * 【验证是否文件已上传了】
       */
      data = await this.verifyUploadWarp(this.container.file.name, this.container.hash);
      if (!data) return;

      // 获取已上传的切片列表
      const { uploadedList } = data;

      this.fileChunkList = fileChunkList.map(({ file }, index) => ({
        index,
        hash: this.container.hash + '-' + index, // 切片 hash
        chunk: file, // 切片内容
        size: file.size, // 切片大小
        percentage:
          !uploadedList || uploadedList.includes(this.container.hash + '-' + index) ? 100 : 0, // 已上传的切片进度直接为 100
      }));
      this.status = Status.uploading;
      await this.uploadChunks(uploadedList);
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
    // 生成文件抽样 hash（web-worker）
    calculateHashSample(file) {
      return new Promise(resolve => {
        this.container.worker = new Worker('/lib/hashSample.js');
        this.container.worker.postMessage({ file });
        this.container.worker.onmessage = e => {
          const { percentage, hash } = e.data;
          this.hashSamplePercentage = percentage;
          if (hash) {
            // 关闭 worker 线程，线程如果不关闭，则会一直在后台运行着，这里在 worker 内部关闭了
            // this.container.worker.terminate();
            resolve(hash);
          }
        };
      });
    },
    // 生成文件 hash（web-worker）
    calculateHash(fileChunkList) {
      return new Promise(resolve => {
        this.container.worker = new Worker('/lib/hash.js');
        this.container.worker.postMessage({ fileChunkList });
        this.container.worker.onmessage = e => {
          const { percentage, hash } = e.data;
          this.hashPercentage = percentage;
          if (hash) {
            // 关闭 worker 线程，线程如果不关闭，则会一直在后台运行着，这里在 worker 内部关闭了
            // this.container.worker.terminate();
            resolve(hash);
          }
        };
      });
    },
    // 通过 window.requestIdleCallback 来解决阻塞 UI 问题，该函数能够利用游览器空闲时间执行
    calculateHashIdle(fileChunkList) {
      return new Promise(resolve => {
        const spark = new SparkMD5.ArrayBuffer();
        const chunkProportion = 100 / fileChunkList.length;
        let count = 0;
        const appendToSpark = async file => {
          return new Promise(resolve => {
            const reader = new FileReader();
            reader.readAsArrayBuffer(file);
            reader.onload = e => {
              spark.append(e.target.result);
              resolve();
            };
          });
        };
        const loadNext = async deadline => {
          if (count < fileChunkList.length && deadline.timeRemaining() > 1) {
            await appendToSpark(fileChunkList[count].file);
            if (count === fileChunkList.length - 1) {
              this.hashPercentage = 100;
              resolve(spark.end()); // 结束 ArrayBuffer 流，获取计算后的文件 md5
            } else {
              this.hashPercentage += chunkProportion;
              window.requestIdleCallback(loadNext);
            }
            count++;
          }
        };
        window.requestIdleCallback(loadNext);
      });
    },
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
    // 根据 hash 验证文件是否曾经已经被上传过
    // 没有才进行上传
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
      const limit = 4;
      const res = await this.sendRequest(requestList, limit);
      console.log(res);
      if (!res.success) return;

      // 获取成功上传的切片
      const sucFileChunkList = this.fileChunkList.filter(item => item.percentage === 100);
      // 获取成功上传的切片数量
      const sucFileChunkCount = sucFileChunkList.length;

      /**
       * 已上传的切片数量 + 本次上传的切片数量 = 所有切片数量时
       * uploadedList.length + requestList.length === this.fileChunkList.length
       * 合并切片
       */
      if (sucFileChunkCount === this.fileChunkList.length) {
        const data = await this.mergeRequest();
        if (data.success) {
          this.$message.success('上传成功');
          this.status = Status.wait;
        }
      }
    },
    async sendRequest(requestList, limit) {
      return new Promise((resolve, reject) => {
        let max = limit;
        let count = 0; // 成功的数量
        const len = requestList.length;
        const start = () => {
          while (count < len && max > 0) {
            max--; // 占用通道

            // 任务不能仅仅累加获取，而是要根据状态
            // wait 和 error 并且 重试次数小于 3 次的可以发出请求 方便重试
            const requestData = requestList.find(
              item =>
                item.status === Status.wait || (item.status === Status.error && item.retryNum <= 2)
            );

            // 找不到有效待上传切块了，
            // 这时候可能还有并发切块在上传中 count 未能达到 len，
            // 所以这时候通过 max 通道不再开放 ++ 控制，进而减少通道
            if (!requestData) continue;

            // 更改状态为：uploading
            requestData.status = Status.uploading;

            const formData = requestData.formData;

            this.request({
              url: '/upload',
              data: formData,
              onProgress: this.createProgressHandler(this.fileChunkList[requestData.index]),
              requestingList: this.requestingList,
            })
              .then(({ data }) => {
                requestData.status = Status.done;
                max++; // 释放通道
                count++;
                start();
              })
              .catch(err => {
                max++; // 释放通道
                requestData.status = Status.error; // 修改状态为报错状态
                this.fileChunkList[requestData.index].percentage = 0; // 重置进度条
                if (typeof requestData['retryNum'] !== 'number') {
                  requestData['retryNum'] = 0;
                }

                // 次数累加
                requestData['retryNum'] += 1;

                // 达到 3 次报错
                if (requestData['retryNum'] > 2) {
                  count++; // 把当前切块 3 次失败后，当做是成功了，不再重试发送了
                  this.fileChunkList[requestData.index].percentage = -1; // 更改上传失败进度条
                }

                start(); // 触发下一个有效切块上传
              });
          }
          if (count >= len) {
            resolve({
              code: 0,
              data: null,
              success: true,
            });
          }
        };
        start();
      });
    },
    // 通知服务端合并切片
    async mergeRequest() {
      const { data } = await this.request({
        url: '/merge',
        headers: {
          'content-type': 'application/json',
        },
        data: JSON.stringify({
          size: SIZE,
          fileHash: this.container.hash,
          fileName: this.container.file.name,
        }),
      });
      return data;
    },
    // 用闭包保存每个 chunk 的进度数据
    createProgressHandler(item) {
      return e => {
        item.percentage = parseInt(String((e.loaded / e.total) * 100));
      };
    },
    request({ url, method = 'post', data, headers = {}, onProgress = e => e, requestingList }) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = onProgress;
        xhr.open(method, baseUrl + url);
        Object.keys(headers).forEach(key => xhr.setRequestHeader(key, headers[key]));
        xhr.send(data);
        xhr.onload = e => {
          // 将请求成功的 xhr 从列表中删除
          if (requestingList) {
            const xhrIndex = requestingList.findIndex(item => item === xhr);
            requestingList.splice(xhrIndex, 1);
          }
          if (e.target.status === 200) {
            resolve({ data: JSON.parse(e.target.response) });
          } else {
            reject(new Error(e.target.status));
          }
        };
        // 暴露当前 xhr 给外部
        requestingList?.push(xhr);
      });
    },
  },
};
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
.cube-container {
  width: 100px;
  overflow: hidden;
  margin: auto;
}
.cube {
  width: 14px;
  height: 14px;
  line-height: 12px;
  border: 1px solid black;
  background: #eee;
  float: left;
}
.cube .success {
  background: #67c23a;
}
.cube .uploading {
  background: #409eff;
}
.cube .error {
  background: #f56c6c;
}
</style>
