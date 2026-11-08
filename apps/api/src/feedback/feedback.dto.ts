import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class FeedbackDto {
  @IsUUID('4')
  submissionId!: string;

  @IsIn(['support', 'child-safety'])
  category!: 'support' | 'child-safety';

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsEmail()
  @MaxLength(254)
  replyEmail?: string;
}
