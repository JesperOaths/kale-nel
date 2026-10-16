package nl.kalenel.s9security;

/** Luma hysteresis prevents brief passing headlights from selecting day policy. */
public final class NightScenePolicy {
 private boolean night;private long brightSince=-1,last=-1;
 public boolean update(double luma,long now){
  if(!Double.isFinite(luma)||luma<0||luma>255||now<0)return night;
  if(last>now)brightSince=-1;last=now;
  if(luma<55){night=true;brightSince=-1;}
  else if(night&&luma>=75){
   if(brightSince<0)brightSince=now;
   if(now-brightSince>=15000){night=false;brightSince=-1;}
  }else brightSince=-1;
  return night;
 }
 public boolean isNight(){return night;}
}
