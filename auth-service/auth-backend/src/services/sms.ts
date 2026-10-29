import { createRequire } from 'module';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import { config } from '../config.js';
import { getLogger } from '../logger.js';

const require = createRequire(import.meta.url);
const DypnsapiClient = require('@alicloud/dypnsapi20170525').default;
const { SendSmsVerifyCodeRequest } = require('@alicloud/dypnsapi20170525');

const log = getLogger('sms');

let client: InstanceType<typeof DypnsapiClient> | null = null;

function getClient(): InstanceType<typeof DypnsapiClient> {
  if (!client) {
    client = new DypnsapiClient(
      new $OpenApiUtil.Config({
        accessKeyId: config.aliyunAccessKeyId,
        accessKeySecret: config.aliyunAccessKeySecret,
        endpoint: 'dypnsapi.aliyuncs.com',
      })
    );
  }
  return client;
}

/**
 * 将 E.164 格式手机号转为阿里云要求的纯数字格式
 * +8613487949925 → 13487949925
 */
function normalizePhoneForAliyun(recipient: string): string {
  let phoneNumber = recipient.replace(/^\+/, '');
  if (/^86\d{11}$/.test(phoneNumber)) {
    phoneNumber = phoneNumber.slice(2);
  }
  return phoneNumber;
}

/**
 * 从 Zitadel 发送的消息文本中提取验证码
 */
function extractCode(message: string): string {
  const codeMatch = message.match(/(\d{4,6})/);
  return codeMatch ? codeMatch[1] : message;
}

/**
 * 通过阿里云 Dypnsapi 发送短信验证码
 * @param recipient E.164 格式手机号，如 +8613487949925
 * @param message Zitadel 传入的消息文本，包含验证码
 */
export async function sendSms(recipient: string, message: string): Promise<void> {
  const phoneNumber = normalizePhoneForAliyun(recipient);
  const code = extractCode(message);

  log.info({ recipient: phoneNumber, code }, 'Sending SMS via Alibaba Cloud (Dypnsapi)');

  const smsClient = getClient();
  const request = new SendSmsVerifyCodeRequest({
    phoneNumber,
    signName: config.aliyunSmsSignName,
    templateCode: config.aliyunSmsTemplateCode,
    templateParam: JSON.stringify({ code, min: '5' }),
  });

  const runtime = new (require('@alicloud/tea-util').RuntimeOptions)();
  const response = await smsClient.sendSmsVerifyCodeWithOptions(request, runtime);

  if (response.body?.code === 'OK') {
    log.info({ recipient: phoneNumber, requestId: response.body.requestId }, 'SMS sent successfully');
  } else {
    log.error(
      { recipient: phoneNumber, code: response.body?.code, message: response.body?.message },
      'Alibaba Cloud SMS failed'
    );
    throw new Error(response.body?.message || 'SMS send failed');
  }
}
