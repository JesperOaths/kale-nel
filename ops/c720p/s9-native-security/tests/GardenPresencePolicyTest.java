package nl.kalenel.s9security;

public final class GardenPresencePolicyTest {
 private static void yes(boolean value,String message){if(!value)throw new AssertionError(message);}
 public static void main(String[] args){
  GardenPresencePolicy p=new GardenPresencePolicy();
  GardenPresencePolicy.Decision d;
  d=p.observe(.49f,.5f,.78f,1000,true,false,false);
  yes(!d.startVideo,"one borderline proposal cannot record");
  d=p.observe(.50f,.52f,.77f,1850,true,false,false);
  yes(d.startVideo&&"confirmed_garden_walkby".equals(d.reason),"repeated weak-light moving person records");
  p.videoStarted(1850);
  d=p.observe(.96f,.51f,.78f,2800,false,false,false);
  yes(!d.startVideo&&p.episodeLatched(),"same visitor must not fill card with clips");
  d=p.observe(.70f,.51f,.77f,4100,false,false,true);
  yes(d.extendVideo&&!d.startVideo,"stationary visitor extends existing recording");
  p.observe(0f,0f,0f,10000,false,false,false);
  d=p.observe(.54f,.5f,.77f,11000,false,false,false);
  yes(!d.startVideo,"fresh episode requires new confirmation");
  d=p.observe(.60f,.5f,.77f,13500,false,false,false);
  yes(d.startVideo,"person standing still is detected after two scans");

  p.reset();
  d=p.observe(.91f,.45f,.8f,1000,true,true,false);
  yes(d.startVideo,"strong in-garden walkby caught on first look");

  p.reset();
  d=p.observe(0f,0f,0f,1000,true,true,false);
  yes(!d.startVideo,"road-only event does not record");
  d=p.observe(0f,0f,0f,1600,true,true,false);
  yes(!d.startVideo,"moving car without person remains ignored");

  p.reset();
  p.observe(.63f,.10f,.6f,1000,true,false,false);
  d=p.observe(.63f,.80f,.9f,1800,true,false,false);
  yes(!d.startVideo,"different distant box cannot form temporal confirmation");
  d=p.observe(.62f,.80f,.9f,2600,false,false,false);
  yes(d.startVideo,"persistent fixed visitor wins without motion");

  p.reset();
  d=p.observe(Float.NaN,.4f,.8f,1000,true,true,false);
  yes(!d.startVideo,"nonfinite model value rejected");
  p.observe(.74f,.4f,.8f,2000,true,true,false);
  d=p.observe(.72f,.4f,.8f,2000,true,true,false);
  yes(!d.startVideo,"same inference timestamp cannot be double-counted");

  p.reset();
  p.observe(.44f,.5f,.8f,1000,false,false,false);
  p.observe(.46f,.51f,.8f,3800,false,false,false);
  d=p.observe(.48f,.52f,.81f,6500,false,false,false);
  yes(d.startVideo,"three low confidence stationary frames trigger");

  System.out.println("GARDEN_PERSON_POLICY_TESTS_PASSED");
 }
}
