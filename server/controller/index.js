import multiparty from 'multiparty';
import path from 'path';
import fse from 'fs-extra';

const extractExt = fileName => fileName.slice(fileName.lastIndexOf('.'), fileName.length); // 提取后缀名
const UPLOAD_DIR = path.resolve(__dirname, '..', 'target'); // 大文件存储目录

// 返回已经上传切片名
const createUploadedList = async fileHash =>
  fse.existsSync(path.resolve(UPLOAD_DIR, fileHash)) // 查看切片目录是否存在
    ? await fse.readdir(path.resolve(UPLOAD_DIR, fileHash)) // 返回已上传的切片地址
    : [];

const pipeStream = (path, writeStream) =>
  new Promise(resolve => {
    const readStream = fse.createReadStream(path);
    readStream.on('end', () => {
      fse.unlinkSync(path);
      resolve();
    });
    readStream.pipe(writeStream);
  });

// 循环读取切换切入目标文件地址
const mergeFileChunk = async (filePath, fileHash, size) => {
  const chunkDir = path.resolve(UPLOAD_DIR, fileHash);
  const chunkPaths = await fse.readdir(chunkDir);
  // 根据切片下标进行排序
  // 否则直接读取目录的获得的顺序可能会错乱
  chunkPaths.sort((a, b) => a.split('-')[1] - b.split('-')[1]);
  await Promise.all(
    chunkPaths.map((chunkPath, index) =>
      pipeStream(
        path.resolve(chunkDir, chunkPath),
        // 指定位置创建可写流
        fse.createWriteStream(filePath, {
          start: index * size,
          end: (index + 1) * size,
        })
      )
    )
  );
  fse.rmdirSync(chunkDir); // 合并后删除保存切片的目录
};

// 检查是否已存在上传文件，未存在也要返回是否存在文件切片了
export const handleVerifyUpload = async ctx => {
  const req = ctx.request;
  const data = req.body;
  const { fileHash, fileName } = data;
  const ext = extractExt(fileName);
  const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`); // 判断文件是否已经有一份上传成功并在服务器了
  if (fse.existsSync(filePath)) {
    return {
      code: 200,
      data: {
        shouldUpload: false,
      },
      message: '',
      success: true,
    };
  } else {
    return {
      code: 200,
      data: {
        shouldUpload: true,
        // 文件未上传，但有可能已上传了部分切片，所以返回的是已上传的所有切片地址
        uploadedList: await createUploadedList(fileHash),
      },
      message: '',
      success: true,
    };
  }
};

// 处理切片
export const handleFormData = async ctx => {
  const req = ctx.req;
  const multipart = new multiparty.Form();

  multipart.on('error', function(err) {
    console.log('Emultipart 解析失败: ' + err.stack);
  });

  return new Promise(resolve => {
    // multipart Api https://www.npmjs.com/package/multiparty
    multipart.parse(req, async (err, fields, files) => {
      // 模拟报错
      if (Math.random() < 0.2) {
        console.log(fields.hash, '500');
        return resolve({
          code: 500,
          data: null,
          message: `上传失败`,
          success: false,
        });
      }
      if (err) {
        return resolve({
          code: 500,
          data: null,
          message: `上传失败【${err}】`,
          success: false,
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
          data: null,
          message: `上传成功`,
          success: true,
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
        data: null,
        message: `切片上传成功【${hash}】`,
        success: true,
      });
    });
  });
};

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
