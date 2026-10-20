import { defineConfig } from '@playwright/test';
const baseURL=process.env.RADAR_TEST_URL||'http://127.0.0.1:3000';
export default defineConfig({testDir:'./tests',testMatch:'**/*.spec.ts',fullyParallel:false,workers:1,reporter:'list',use:{baseURL,channel:'chrome',headless:true,trace:'retain-on-failure'},webServer:{command:'npm run dev',url:baseURL,reuseExistingServer:true},timeout:30000});
