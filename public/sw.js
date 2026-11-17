// Notifications only. No caching of medical data, credentials or API responses.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let payload={};try{payload=event.data?.json()||{};}catch{}
 event.waitUntil(self.registration.showNotification(payload.title||'MedSense',{
  body:payload.body||'Новые данные / New data',icon:'/icon-192.png',badge:'/icon-192.png',
  tag:payload.tag||'medsense-update',data:{patientId:Number(payload.patientId)||null},
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const patientId=event.notification.data?.patientId;
  const url=new URL('/',self.location.origin);if(patientId)url.searchParams.set('patient',String(patientId));
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const target=windows.find(client=>new URL(client.url).origin===self.location.origin);
  if(target){await target.navigate(url.href);await target.focus();}else await self.clients.openWindow(url.href);
 })());
});
