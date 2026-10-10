/**
 * CityConfig DTO
 * 来源：shared DTO checklist — CityConfigDto
 */
export interface CityConfigDto {
  cityId: number;
  cityName: string;
  enableMaintenance: boolean;
  updatedBy: number | null;
  updatedAt: string | null;
}
