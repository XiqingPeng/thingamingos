let english=false;try{english=localStorage.getItem('thingamingos-language')==='en';}catch{}
if(english){document.documentElement.lang='en';document.querySelector('#offline-title').textContent='Your room is waiting for a connection';document.querySelector('#offline-message').textContent='Reconnect to continue with your companions and memories.';document.querySelector('#retry').textContent='Try again';}
document.querySelector('#retry').addEventListener('click',()=>location.reload());
