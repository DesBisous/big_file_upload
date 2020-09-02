import { handleVerifyUpload, handleMerge, handleFormData } from '../../controller';

const verify = async (ctx, next) => {
  const data = await handleVerifyUpload(ctx);
  ctx.body = data;
};

const upload = async (ctx, next) => {
  const data = await handleFormData(ctx);
  ctx.response.status = data.code;
  ctx.body = data;
};

const merge = async (ctx, next) => {
  const data = await handleMerge(ctx);
  ctx.body = data;
};

module.exports = [
  {
    method: 'POST',
    path: '/verify',
    func: verify
  },
  {
    method: 'POST',
    path: '/upload',
    func: upload
  },
  {
    method: 'POST',
    path: '/merge',
    func: merge
  },
]
