self.addEventListener("install",event=>{self.skipWaiting();});
self.addEventListener("activate",event=>{event.waitUntil(self.clients.claim());});

self.addEventListener("push",event=>{
  let payload={};
  try{payload=event.data?event.data.json():{};}catch(_){payload={body:event.data?event.data.text():""};}
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of windows){
      client.postMessage({type:"VAYANA_PUSH_NOTIFICATION",payload});
    }
    await self.registration.showNotification(payload.title||"VAYANA Live Chat",{
      body:payload.body||"A customer service update has arrived.",
      tag:(payload.type||"customer-service")+"-"+(payload.sentAt||Date.now()),
      renotify:true,
      requireInteraction:true,
      data:{url:payload.url||"/admin.html"}
    });
  })());
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||"/admin.html",self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of windows){
      if("focus" in client){
        await client.focus();
        if("navigate" in client)await client.navigate(target);
        return;
      }
    }
    if(self.clients.openWindow)await self.clients.openWindow(target);
  })());
});
