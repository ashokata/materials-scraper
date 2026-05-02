import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

export class SearchQueryDto {
  @IsString()
  q: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  page?: number = 1;
}

export class ProductUrlDto {
  @IsString()
  url: string;
}

export class CategoryQueryDto {
  @IsString()
  url: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  page?: number = 1;
}

export class StoreAvailabilityDto {
  @IsString()
  sku: string;

  @IsString()
  zipCode: string;
}
