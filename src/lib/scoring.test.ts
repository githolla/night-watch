import test from "node:test";import assert from "node:assert/strict";import {score,strength} from "./scoring.ts";
test("job strength caps at 40",()=>assert.equal(strength("job_post",{days_open:40,reposted:true,salary_max:150000}),40));
test("owner job cluster clears threshold",()=>assert.ok(score({type:"job_cluster",level:"owner",observedAt:new Date().toISOString(),pathScore:0}).score>=60));
