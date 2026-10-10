/**
 * 城市实体
 * 来源：DDL cities 表
 */
export interface City {
  id: number;
  name: string;
  code: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
