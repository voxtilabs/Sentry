import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MailSettingsDto } from './operations.dto';
import { UpdateRulesPipe } from '../rules/dto/update-rules.dto';
const validate=(input:unknown)=>validateSync(plainToInstance(MailSettingsDto,input),{whitelist:true,forbidNonWhitelisted:true});
describe('mail settings boundary',()=>{
 it('accepts the web payload with independent monthly recipients',()=>{
  expect(validate({recipients:['ops@example.cl'],onlyBelowThreshold:true,threshold:75,hour:8,
   dailyEnabled:false,weeklyEnabled:false,monthlyEnabled:true,dailyRecipients:[],weeklyRecipients:[],monthlyRecipients:['cliente@example.cl']})).toEqual([]);
 });
 it.each([{threshold:101},{hour:24},{monthlyEnabled:'true'},{monthlyRecipients:['invalid']},{monthlyRecipients:Array(11).fill('a@example.cl')},{gpsTrackingEnabled:false},{siteId:'untrusted'}])('rejects invalid settings and unrelated business rules: %o',input=>{
  expect(validate({recipients:[],...input}).length).toBeGreaterThan(0);
 });
 it('forbids platform-wide recipient lists and checkpoint mail scheduling',()=>{
  expect(()=>new UpdateRulesPipe('platform').transform({reportMonthlyRecipients:['cliente@example.cl']})).toThrow();
  expect(()=>new UpdateRulesPipe('checkpoint').transform({reportDailyEnabled:true})).toThrow();
 });
});
