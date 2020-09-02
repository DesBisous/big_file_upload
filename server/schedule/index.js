import path from 'path';
import fse from 'fs-extra';
const schedule = require('node-schedule');

const UPLOAD_DIR = path.resolve(__dirname, '..', 'target'); // 大文件存储目录

// 空目录删除
function remove(file, stats) {
  const now = new Date().getTime();
  const offset = now - stats.ctimeMs;
  if (offset > 1000 * 60 * 60) {
    // 大于 1 小时的碎片
    console.log(file, '过期了，删除');
    if (stats.isDirectory()) fse.rmdir(file);
    else fse.unlinkSync(file);
  }
}

async function scan(dir, callback) {
  const files = fse.readdirSync(dir);
  files.forEach(filename => {
    const fileDir = path.resolve(dir, filename);
    const stats = fse.statSync(fileDir);
    if (stats.isDirectory()) {
      scan(fileDir, remove);
      const _files = fse.readdirSync(fileDir); // 获取当前目录所包含的内容
      // 如果目录里没有内容了，删除
      if (_files.length <= 0) {
        // 删除切片目录
        remove(fileDir, stats);
      }
      return;
    }
    // 只会删除切片文件，不会删除第一层完整文件
    if (callback) {
      callback(fileDir, stats);
    }
  });
}

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

  // 每3秒
  schedule.scheduleJob('*/30 * * * *', function() {
    console.log('开始扫描');
    scan(UPLOAD_DIR);
  });
}
