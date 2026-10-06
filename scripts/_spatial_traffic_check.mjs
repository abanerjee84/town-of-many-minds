import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5176');
  await page.waitForFunction(()=>window.town?.traffic);
  const result = await page.evaluate(async()=>{
    const {default:rules}=await import('/src/data/performance.json?import');
    rules.agents.spatialVehicleThreshold=0;
    const t=window.town,c=window.clock; t.generate(1337); c.reset(); c.speed=0; c.hour=8;
    const traffic=t.traffic;
    let queries=0, candidates=0, full=0;
    for(const [method,roster] of [['nearVehicles',()=>traffic.vehicles],['nearPedestrians',()=>t.pedestrians.citizens]]) {
      const original=traffic[method];
      traffic[method]=function(x,z,r,...args) {
        const found=original.call(this,x,z,r,...args);
        const source=args[0] || roster();
        const exact=a=>Math.abs(a.group.position.x-x)<=r && Math.abs(a.group.position.z-z)<=r;
        const actual=found.filter(exact), expected=source.filter(exact);
        if(actual.length!==expected.length || actual.some((a,i)=>a!==expected[i]))
          throw Error(`${method} changed candidate coverage or first-blocker order`);
        if(this.spatialActive) {queries++; candidates+=found.length; full+=source.length;}
        return found;
      };
    }
    let collisionChecks = 0;
    const prototype = Object.getPrototypeOf(t.pedestrians.citizens[0]);
    const blocked = prototype.vehicleBlocked;
    prototype.vehicleBlocked = function(x,z) {
      const actual = blocked.call(this,x,z);
      if (++collisionChecks % 17 === 0) {
        const expected = traffic.vehicles.some(v => {
          const dx=x-v.group.position.x, dz=z-v.group.position.z;
          if(Math.abs(dx)>5 || Math.abs(dz)>5) return false;
          const c=Math.cos(v.group.rotation.y), s=Math.sin(v.group.rotation.y);
          const lx=dx*c-dz*s,lz=dx*s+dz*c;
          const w=v.spec.width*0.5+0.28,l=v.spec.length*0.5+0.28;
          const front=v.pedWaitT>2?1.6:0,side=v.pedWaitT>2?0.9:0;
          const body=(a,b)=>Math.abs(a)<w && Math.abs(b)<l;
          const zone=(a,b)=>Math.abs(a)<w+side && b>-l-side && b<l+front;
          if(!zone(lx,lz)) return false;
          const ox=this.group.position.x-v.group.position.x,oz=this.group.position.z-v.group.position.z;
          const olx=ox*c-oz*s,olz=ox*s+oz*c;
          if((!body(lx,lz)&&zone(olx,olz)||body(olx,olz)) && Math.hypot(dx,dz)>Math.hypot(ox,oz)+0.0001) return false;
          return true;
        });
        if(actual!==expected) throw Error('Cached local obstacle bounds changed an exact body/courtesy result');
      }
      return actual;
    };
    const signalBefore=t.roadKit.signals.t, pedestrianBefore=t.pedestrians.time;
    for(let i=0;i<200;i++) traffic.runShared(0.05,c);
    if(Math.abs((t.roadKit.signals.t-signalBefore)-(t.pedestrians.time-pedestrianBefore))>0.000001)
      throw Error('signal phases diverged from pedestrian/vehicle time');
    // External position edits must be visible at the next frame boundary.
    t.pedestrians.citizens[0].group.position.x+=16;
    traffic.runShared(0.05,c);
    if(traffic.spatialActive) throw Error('index leaked outside physics update');
    const largeSignal=t.roadKit.signals.t, largePed=t.pedestrians.time;
    traffic.runShared(1296,c);
    if(Math.abs((t.roadKit.signals.t-largeSignal)-(t.pedestrians.time-largePed))>0.000001)
      throw Error('signals skipped physics phases when the agent budget overflowed');
    const indoor=t.pedestrians.citizens[0];
    indoor.enterBuilding(indoor.home);
    indoor.strollTimer=10000;
    const before=indoor.strollTimer;
    for(let i=0;i<100;i++) t.pedestrians.step(0.05,c,{lodStartPopulation:1,lodMaxStride:8});
    const expected=5*(1+indoor.p.traits.openness);
    const actual=before-indoor.strollTimer;
    if(Math.abs(actual-expected)>0.4*(1+indoor.p.traits.openness)+0.001)
      throw Error('idle LOD lost elapsed timer time');
    return {queries,candidates,full, collisionChecks, timerSeconds:actual};
  });
  assert.equal(errors.length,0);
  assert(result.queries>100);
  assert(result.candidates<result.full);
  console.log(JSON.stringify({ok:true,...result}));
} finally {await browser.close();}
