import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { BizAuthContext } from '../rbac/rbac.service';
import { FactSourceFileStorageService } from '../facts/fact-source-file-storage.service';
import { MaintenanceDocumentEntity, MaintenanceKind } from './maintenance-document.entity';

const DOCUMENT_CATEGORIES: Record<MaintenanceKind, ReadonlySet<string>> = {
  personnel: new Set(['idCard', 'lowVoltageCert', 'highVoltageCert', 'workAtHeightCert', 'employerLiabilityInsurance', 'teamAccidentInsurance']),
  vehicles: new Set(['drivingLicense', 'compulsoryInsurance', 'commercialInsurance', 'maintenanceRecord']),
  generators: new Set(['generatorDocument', 'maintenanceRecord']),
};
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/bmp', 'image/webp']);
const MAX_FILE_BYTES = 15 * 1024 * 1024;

type OcrField = { key: string; text: string };

@Injectable()
export class MaintenanceDocumentService {
  constructor(
    @InjectRepository(MaintenanceDocumentEntity) private readonly repo: Repository<MaintenanceDocumentEntity>,
    private readonly storage: FactSourceFileStorageService,
    private readonly config: ConfigService,
  ) {}

  async upload(kind: MaintenanceKind, category: string, file: Express.Multer.File, auth: BizAuthContext) {
    if (!DOCUMENT_CATEGORIES[kind]?.has(category)) throw new BadRequestException('资料类型与维护对象不匹配');
    if (!file?.buffer?.length) throw new BadRequestException('请选择资料文件');
    if (file.size > MAX_FILE_BYTES) throw new BadRequestException('单个文件不能超过 15MB');
    const mimeType = file.mimetype || 'application/octet-stream';
    if (!ALLOWED_MIME.has(mimeType)) throw new BadRequestException('仅支持 PDF、JPG、PNG、BMP 或 WEBP 文件');
    const fileName = (file.originalname ?? 'document').slice(0, 255);
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const stored = await this.storage.store(file.buffer, fileName, hash);
    let extracted: { text: string; fields: OcrField[] } | null = null;
    let extractionError: string | null = null;
    try { extracted = await this.extract(kind, category, file.buffer, mimeType); }
    catch (error) { extractionError = error instanceof Error ? error.message : 'OCR识别失败'; }
    const entity = this.repo.create({
      id: randomUUID(), maintenanceKind: kind, maintenanceId: null, documentCategory: category,
      fileName, mimeType, fileSize: file.size, fileSha256: hash, storageKey: stored.storageKey,
      extractedText: extracted?.text || null, createdBy: auth.userId,
    });
    await this.repo.save(entity);
    return { id: entity.id, fileName, mimeType, fileSize: file.size, category, extractedText: extracted?.text ?? '', fields: extracted?.fields ?? [], ocrAvailable: Boolean(this.config.get('TENCENTCLOUD_SECRET_ID') && this.config.get('TENCENTCLOUD_SECRET_KEY')), extractionError };
  }

  async list(kind: MaintenanceKind, maintenanceId: string, auth: BizAuthContext) {
    const items = await this.repo.find({ where: { maintenanceKind: kind, maintenanceId, createdBy: auth.userId }, order: { createdAt: 'DESC' } });
    return items.map(({ id, documentCategory, fileName, mimeType, fileSize, createdAt }) => ({ id, category: documentCategory, fileName, mimeType, fileSize, createdAt }));
  }

  async listPending(kind: MaintenanceKind, auth: BizAuthContext) {
    const items = await this.repo.find({ where: { maintenanceKind: kind, maintenanceId: IsNull(), createdBy: auth.userId }, order: { createdAt: 'DESC' } });
    return items.map(({ id, documentCategory, fileName, mimeType, fileSize, createdAt }) => ({ id, category: documentCategory, fileName, mimeType, fileSize, createdAt }));
  }

  async download(id: string, auth: BizAuthContext) {
    const entity = await this.repo.findOneBy({ id, createdBy: auth.userId });
    if (!entity) throw new NotFoundException('资料文件不存在');
    const buffer = await this.storage.read(entity.storageKey);
    if (createHash('sha256').update(buffer).digest('hex') !== entity.fileSha256) throw new BadRequestException('文件校验失败');
    return { buffer, fileName: entity.fileName, mimeType: entity.mimeType };
  }

  async attach(kind: MaintenanceKind, maintenanceId: string, ids: string[], auth: BizAuthContext) {
    if (!Array.isArray(ids) || ids.length > 100) throw new BadRequestException('资料文件数量无效');
    if (!ids.length) return;
    const files = await this.repo.findBy(ids.map((id) => ({ id, maintenanceKind: kind, createdBy: auth.userId })));
    if (files.length !== new Set(ids).size) throw new BadRequestException('资料不存在或不属于当前账号');
    for (const file of files) {
      if (file.maintenanceId) throw new BadRequestException('资料文件已关联过记录，请重新上传后再关联');
      file.maintenanceId = maintenanceId;
    }
    await this.repo.save(files);
  }

  private async extract(kind: MaintenanceKind, category: string, buffer: Buffer, mimeType: string): Promise<{ text: string; fields: OcrField[] } | null> {
    const secretId = this.config.get<string>('TENCENTCLOUD_SECRET_ID');
    const secretKey = this.config.get<string>('TENCENTCLOUD_SECRET_KEY');
    if (!secretId || !secretKey) return null;
    const isPdf = mimeType === 'application/pdf';
    if (isPdf && buffer.length > 7 * 1024 * 1024) return null;
    const action = kind === 'personnel' && category === 'idCard' ? 'IDCardOCR'
      : kind === 'vehicles' && category === 'drivingLicense' ? 'VehicleLicenseOCR'
        : 'GeneralAccurateOCR';
    const payload: Record<string, unknown> = { ImageBase64: buffer.toString('base64') };
    if (action === 'GeneralAccurateOCR' && isPdf) Object.assign(payload, { IsPdf: true, PdfPageNumber: 1 });
    const response = await this.tencentOcr(secretId, secretKey, action, payload);
    if (action === 'IDCardOCR' || action === 'VehicleLicenseOCR') {
      const result = response.Response as Record<string, unknown>;
      const fields = Object.entries(result).filter(([key, value]) => key !== 'RequestId' && typeof value === 'string' && value).map(([key, text]) => ({ key, text: String(text) }));
      return { text: fields.map((field) => field.text).join('\n'), fields };
    }
    const result = response.Response as { TextDetections?: Array<{ DetectedText?: string }> };
    const text = (result.TextDetections ?? []).map((item) => item.DetectedText ?? '').filter(Boolean).join('\n');
    return { text, fields: this.mapGenericFields(kind, category, text) };
  }

  private mapGenericFields(kind: MaintenanceKind, category: string, text: string): OcrField[] {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const fields: OcrField[] = [];
    const dates = [...text.matchAll(/(?:20\d{2})[年./-](?:0?[1-9]|1[0-2])[月./-](?:0?[1-9]|[12]\d|3[01])日?/g)].map((match) => match[0].replace(/[年月.]/g, '-').replace(/日$/, ''));
    const policy = lines.find((line) => /保单号|保险单号|单号|policy/i.test(line))?.match(/[A-Z0-9-]{6,}/i)?.[0]
      ?? text.match(/\b[A-Z]{1,4}[-]?[A-Z0-9]{8,}\b/i)?.[0];
    if (policy) fields.push({ key: 'policyNo', text: policy });
    if (dates.length) fields.push({ key: 'expiryDate', text: dates[dates.length - 1] });
    if (kind === 'personnel' && /Cert/i.test(category) && dates.length) fields.push({ key: 'certificateExpiry', text: dates[dates.length - 1] });
    if (kind === 'personnel' && /Insurance/.test(category)) {
      const amount = text.match(/(?:保险金额|保额|责任限额|赔偿限额)[^\d]{0,12}(\d+(?:\.\d+)?)/)?.[1];
      if (amount) fields.push({ key: 'insuranceAmount', text: amount });
    }
    if (kind === 'vehicles' && category === 'maintenanceRecord' && dates.length) fields.push({ key: 'maintenanceDate', text: dates[0] });
    if (kind === 'generators' && category === 'maintenanceRecord' && dates.length) fields.push({ key: 'maintenanceDate', text: dates[0] });
    return fields;
  }

  private async tencentOcr(secretId: string, secretKey: string, action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const host = 'ocr.tencentcloudapi.com';
    const service = 'ocr';
    const version = '2018-11-19';
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const body = JSON.stringify(payload);
    const hashedPayload = createHash('sha256').update(body).digest('hex');
    const canonicalRequest = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${host}\n\ncontent-type;host\n${hashedPayload}`;
    const scope = `${date}/${service}/tc3_request`;
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${createHash('sha256').update(canonicalRequest).digest('hex')}`;
    const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest();
    const secretDate = hmac(`TC3${secretKey}`, date);
    const secretService = hmac(secretDate, service);
    const secretSigning = hmac(secretService, 'tc3_request');
    const signature = hmac(secretSigning, stringToSign).toString('hex');
    const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`;
    const response = await fetch(`https://${host}`, {
      method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json; charset=utf-8', Host: host, 'X-TC-Action': action, 'X-TC-Timestamp': String(timestamp), 'X-TC-Version': version }, body,
      signal: AbortSignal.timeout(30_000),
    });
    const json = await response.json() as Record<string, unknown>;
    const error = (json.Response as { Error?: { Message?: string } } | undefined)?.Error;
    if (!response.ok || error) throw new ServiceUnavailableException(error?.Message || 'OCR服务暂不可用');
    return json;
  }
}
