/** What the rest of the system sees. Raw MoySklad shapes never leave this package. */
export interface MsFolder {
  msId: string;
  name: string;
  pathName: string;
  parentMsId: string | null;
  archived: boolean;
  updated: Date | null;
}

export interface MsImageRef {
  msImageId: string;
  filename: string;
  size: number;
  updated: Date | null;
  downloadHref: string;
}

export interface MsProduct {
  msId: string;
  name: string;
  article: string;
  code: string;
  externalCode: string;
  description: string;
  barcodes: string[];
  folderMsId: string | null;
  folderPathName: string;
  uom: string | null;
  packSize: number | null;
  /** Integer UZS. */
  price: number | null;
  oldPrice: number | null;
  archived: boolean;
  updated: Date;
  brandName: string | null;
  images: MsImageRef[];
  /** True when the images list was NOT expanded (limit>100) and must be fetched separately. */
  imagesExpanded: boolean;
}

export interface MsStockRow {
  msId: string;
  quantity: number;
}

export interface MappingConfig {
  priceTypeId: string;
  oldPriceTypeId: string;
  brandAttributeId: string;
  timezoneOffsetHours: number;
}

export interface OrderPositionInput {
  productMsId: string;
  /** Integer UZS. */
  unitPrice: number;
  quantity: number;
  reserve?: number;
}

export interface CreateOrderInput {
  organizationId: string;
  counterpartyId: string;
  storeId?: string;
  salesChannelId?: string;
  stateId?: string;
  name: string;
  externalCode: string;
  syncId: string;
  description: string;
  shipmentAddress: string;
  positions: OrderPositionInput[];
  /** Skip webhooks whose URL starts with this prefix, so our own writes do not echo back. */
  disableWebhooksByPrefix?: string;
}
