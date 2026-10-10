import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
export class CreatePersonnelDto {
  @IsString() @IsNotEmpty() @MaxLength(100) personnelCode!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) orgProvince!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) orgCompany!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) orgRegion!: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsInt() @Min(0) @Max(150) age?: number;
  @IsOptional() @IsString() account?: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsString() employmentType?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() @MaxLength(32) idCard?: string;
  @IsOptional() @IsString() @MaxLength(160) lowVoltageCert?: string;
  @IsOptional() @IsString() @MaxLength(64) lowVoltageCertExpiry?: string;
  @IsOptional() @IsString() @MaxLength(160) highVoltageCert?: string;
  @IsOptional() @IsString() @MaxLength(64) highVoltageCertExpiry?: string;
  @IsOptional() @IsString() @MaxLength(160) workAtHeightCert?: string;
  @IsOptional() @IsString() @MaxLength(64) workAtHeightCertExpiry?: string;
  @IsOptional() @IsString() @MaxLength(64) employerLiabilityAmount?: string;
  @IsOptional() @IsString() @MaxLength(160) employerLiabilityPolicyNo?: string;
  @IsOptional() @IsString() @MaxLength(64) employerLiabilityExpiry?: string;
  @IsOptional() @IsString() @MaxLength(64) teamAccidentAmount?: string;
  @IsOptional() @IsString() @MaxLength(160) teamAccidentPolicyNo?: string;
  @IsOptional() @IsString() @MaxLength(64) teamAccidentExpiry?: string;
  @IsOptional() @IsString() @MaxLength(64) teamAccidentAmount2?: string;
  @IsOptional() @IsString() @MaxLength(160) teamAccidentPolicyNo2?: string;
  @IsOptional() @IsString() @MaxLength(64) teamAccidentExpiry2?: string;
  @IsOptional() @IsString() @MaxLength(64) teamAccidentAmount3?: string;
  @IsOptional() @IsString() @MaxLength(160) teamAccidentPolicyNo3?: string;
  @IsOptional() @IsString() @MaxLength(64) teamAccidentExpiry3?: string;
  @IsOptional() @IsString() @MaxLength(255) personnelCondition?: string;
}
export class UpdatePersonnelDto extends CreatePersonnelDto {}
