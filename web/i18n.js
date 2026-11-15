// Translate authored UI fragments only. Interpolated names and memories stay untouched.
const entries = `
朋友|friend
小屋暂时没接上，请稍后重试|The room is temporarily unavailable. Please try again.
这次没有保存成功，请再试一次|Unable to save. Please try again.
连接超时，输入已保留，请重试|Connection timed out. Your input is preserved.
等对方回应|Awaiting a reply
双方已确认|Confirmed by both
本人记录|Personal record
对方保留不同意见|Different recollection
共同经历|Shared moment
一份心意|A thoughtful gift
小小约定|A little promise
回应这段记忆 ↗|Reply to this memory ↗
修改|Edit
让它忘记|Forget this memory
记下|recorded
这段故事，我记得。|I remember that story.
今天可以早点下班吗？|Can we finish early today?
今天也有好好长大。|Growing a little every day.
我有一点小想法。|I have a little thought.
给我讲讲你的故事吧。|Tell me our story.
视频物品|Video item
物品们正在酝酿对话…|Our companions are finding their words…
开一场小剧场|Start a little scene
其他物品|Other item
杯子|Cup
键盘|Keyboard
植物|Plant
段记忆|memories
的小伙伴|'s companion
打开记忆：|Open memory: 
还没有记忆，先讲个故事吧。|No memories yet. Tell a little story.
第一段故事，|The first story
就从你开始吧。|begins with you.
查看原照片 / 视频 ↗|View original photo / video ↗
查看全部记忆 ↗|View all memories ↗
小东西，|Little things, 
也有大心事。|big feelings.
把日常收进小屋，让它们记住你们的故事。|Give everyday things a home and a story to remember.
收进一件物品|Add an item
今天，小屋也有话想说|A room full of stories
点一点，听听谁在惦记你|Choose a companion to open its memories
故事还在继续|The story goes on
当前物品：|Selected: 
住在这里的小伙伴|Living here
点击物品，翻翻它的记忆|Choose an item to explore its memories
的记忆抽屉|'s memory drawer
那些被记住的小事，让它成为特别的它。|Little moments make this companion yours.
＋ 告诉它一件小事|＋ Share a little moment
← 返回小剧场|← Back to the scene
阅读进度已保留|Your place is saved
这里暂时还没有故事。|No stories here yet.
回小屋，告诉物品一件小事吧。|Head home and share a little moment.
记忆里，都是你们。|Your stories, remembered.
谁记下了什么，谁补充了后来，都在这里。|Every memory keeps its author and every reply.
全部记忆|All memories
等我回应|Awaiting my reply
当前身份|Current profile
位物品伙伴|item companions
段与 TA 有关的记忆|memories involving this person
赠送故事|Gift story
待对方回应|Awaiting their reply
保留不同意见|Different recollection
已记录|Recorded
查看故事 ↗|View story ↗
给一段故事标注朋友，这里就会长出连线。|Tag a friend in a story to grow a connection.
一件物品，连接两个人。|One little thing. Two people.
你说“这是他送我的”，故事里就多了一个可以回应的人。|A gift connects a story to someone who can tell their side.
故事里的连线|Connections in your stories
小小世界|Little world
记忆抽屉|Memory drawer
故事里的人|People in our stories
物语首页|thingamingos home
有些小东西，|Some little things
替我们记得很久。|remember for us.
我们的记忆小屋|Our memory room
邀请朋友|Invite a friend
原创像素小屋|An original pixel home
共享记忆 · 演示身份|Shared memories · profile preview
小剧场标注生成方式与记忆来源|Scenes show their generation method and memory sources
当前浏览器保存 · 演示身份|Saved in this browser · profile preview
保存这段故事|Save this story
稍后再说|Maybe later
先记在我们之间|Keep this between us
让一件小东西住进来|Welcome a little companion
给它一个名字，再讲讲你们的故事。|Give it a name and tell your story.
带一张照片，或一段小视频|Bring a photo or a short video
最大|up to
它叫什么？|What is its name?
它是什么？|What kind of item is it?
它的性格|Its personality
你们之间的第一段故事|Your first story together
故事里，还有谁？|Who else is in this story?
标注后，对方可以在“等我回应”中确认和补充。|They can confirm or add their side in Awaiting my reply.
这是一份 TA 送的礼物|This was a gift from them
欢迎它住进来|Welcome it home
重新讲讲这段记忆|Edit this memory
告诉它一件小事|Share a little moment
修改关联记忆后，会请对方重新回应。|Editing a tagged memory asks the other person to respond again.
关联 @|Tagged @
这是什么记忆？|What kind of memory?
想让它记住什么？|What should it remember?
你也记得这件事吗？|Do you remember this too?
补上你的版本（选填）|Add your side (optional)
这段故事的状态|Your response
我记得，确认这段故事|I remember. Confirm this story.
我有不同记忆，暂不确认|I remember differently. Do not confirm.
留下我的回应|Save my reply
让小屋热闹一会儿|Let the room come to life
选好伙伴和话题，听它们一人一句慢慢聊。|Choose companions and a topic. Let their conversation unfold.
谁来参加？|Who is joining?
今天聊什么？|What shall we talk about?
准备好后自动逐句开场，每句留出阅读时间。随时可以暂停、下一句或立即看完；引用的记忆可以点开查看。|The scene unfolds one line at a time. Pause, skip a line, or show it all. Open any cited memory to see its source.
让它们开口|Let them talk
最多选择三位，请先取消一位再换人|Choose up to three. Remove one before adding another.
，先取消一位即可换人|; remove one to choose another
已选|Selected
这段记忆已经被忘记了|This memory has been forgotten.
正在切换身份，请稍候|Switching profiles. One moment…
把小屋链接交给朋友|Share your room with a friend
拿到链接的人可以进入这个演示小屋。可用不同浏览器体验多人互动。|Anyone with this link can enter this room. Try separate browsers for different participants.
共享小屋链接|Shared room link
当前用演示身份体验：朋友进入后切换为小北或阿栗，就能回应被标注的故事。|Profiles are switchable in this preview. Your friend can choose another profile to reply to tagged stories.
把这段记忆放下？|Let this memory go?
物品会停止在新剧场中引用它，已保存的相关剧场也会清除。|New scenes will stop citing this memory. Saved related scenes will be cleared too.
物品的经历来自用户记录，照片和视频用于呈现它的样子。|Experiences come from your records. Photos and videos show what it looks like.
现在以|Now using 
的演示身份体验|'s preview profile
文件请控制在|Keep the file under 
以内|or less
上传预览|Upload preview
上一条提交还在保存，请稍候|Your previous change is still saving. One moment…
身份已变化，请关闭表单后重新打开|Your profile changed. Close and reopen this form.
这段记忆已变化，请关闭后重新查看|This memory changed. Close this form and review it again.
正在收好故事…|Saving your story…
请选一到三位小伙伴|Choose one to three companions.
AI 小剧场开场了，记忆来源可以点开看。|Your AI scene is ready. Open any memory source.
AI 对话暂时没能完成，已用规则小剧场开场。|AI generation could not finish. A rules-based scene is ready instead.
规则小剧场开场了，记忆来源可以点开看。|A rules-based scene is ready, with memory sources.
故事已经收进记忆抽屉。|Your story is safe in the memory drawer.
小剧场正在酝酿，或记忆刚有变化，请稍后重新开场。|A scene is underway, or a memory just changed. Please try again shortly.
小剧场暂时没能开场，请稍后重试；刚才的选择已保留。|The scene could not start. Your selections are preserved.
故事已保存，页面暂时没接上，请稍后刷新|Your story was saved. Please refresh to reconnect.
这段记忆已变化。请关闭表单，重新查看最新内容后再回应。|This memory changed. Close the form and review the latest version before replying.
请关闭后重新查看|Close and review again
小屋暂时没有接上|The room is temporarily unavailable
重新打开|Try again
AI 生成 · LLM|AI-generated · LLM
规则生成 · 回退|Rules-based · fallback
这次 AI 对话暂时没能完成，已改用规则生成。记忆来源与确认状态仍然保留。|AI generation could not finish. This scene uses rules instead; memory sources and confirmation states remain intact.
规则生成|Rules-based
正在接话…|The conversation is unfolding…
已暂停，慢慢看这一句。|Paused. Take your time.
全场结束 · 已完整呈现|Scene complete · all lines shown
已呈现|Shown
重播这场|Replay scene
暂停这场小剧场|Pause this scene
继续播放这场小剧场|Resume this scene
暂停|Pause
继续|Resume
下一句|Next line
立即看完|Show all
翻开这段记忆|Open memory
待对方确认|Awaiting their confirmation
查看记录|View record
小剧场播放控制|Scene playback controls
小剧场 ·|Scene ·
出演：|Featuring: 
请填写物品名字和类型，不能只填空格|Enter an item name and type, not just spaces.
填写的内容太长，请缩短后再保存|Your entry is too long. Please shorten it.
请选择小屋里的另一位朋友|Choose another friend in this room.
标注朋友时，请写下你们的故事|Add a story when tagging a friend.
赠送故事需要选择赠送者|Choose who gave you this gift.
比如，老朋友|For example, Old Friend
比如，保温杯、相机、毛绒玩具|For example, a flask, camera, or plush toy
嘴硬心软，偶尔有点吃醋|A soft heart behind a gruff voice
比如，这是小北毕业时送我的杯子，一直陪我到现在。|For example, this was a graduation gift from my friend.
一段经历、一个约定，或者一句想说的话…|A moment, a promise, or something you want to say…
比如，那天挑了很久，希望它能多陪你几年。|For example, I chose it hoping it would stay with you for years.
比如，关于那份一直留着的礼物|For example, a gift you still treasure
那些舍不得换掉的小东西|The little things we cannot let go of
关闭|Close
切换演示用户|Switch profile
小屋演示成员|Room profiles
主导航|Main navigation
物品小屋|Companions in the room
物品列表|Your collection
新对话将使用当前语言，已保存的故事保留原文。|New scenes use your selected language. Saved stories keep their original wording.
物语的小屋正在醒来…|Your little room is waking up…
物品的想法与提问|A companion's thoughts and questions
所有物品|All items
搜索物品|Search items
搜索名称、类型或性格|Search names, types, or personalities
上一页|Previous
下一页|Next
换一组上桌|Next companions
桌上伙伴|On the table
没有找到匹配的物品|No matching items
清空搜索|Clear search
这是|This is 
之间的故事。|'s shared story.
的故事里标注了你。| tagged you in this story.
在| in 
与| and 
查看|View 
的记忆|'s memories
物品|item
小屋|room
第 |Line 
 句，共 | of 
 句。|. 
 句| lines
 位| companions

 位物品伙伴| companions
上传物品照片或视频|Upload an item photo or video
小屋成员|Room members
记忆|Memories
管理|Users
看看它的记忆|Open its memories
添加到桌面|Add to Home Screen
把小屋放到桌面|A little home on your Home Screen
你已经在桌面版小屋里了。|You are already using the Home Screen app.
下次见面，点一下桌面图标就好。|Next time, just tap your Home Screen icon.
在 iPhone 的 Safari 中打开这个网站。|Open this website in Safari on your iPhone.
点分享按钮，再选“添加到主屏幕”。|Tap Share, then Add to Home Screen.
如果看到“作为网页 App 打开”，保持开启，再点“添加”。|If Open as Web App appears, keep it on, then tap Add.
桌面图标会保留当前小屋；首次打开若出现登录页，登录后即可继续。|The icon keeps your room link. If you see a login page when opening it for the first time, log in to continue.
网站需要网络连接。微信内打开时，请先选择“在 Safari 中打开”。|A connection is needed. From WeChat, open this page in Safari first.
复制小屋链接|Copy room link
小屋链接已复制|Room link copied
请长按链接复制|Touch and hold the link to copy it
创建账号|Create account
欢迎回到小屋|Welcome home
用一个账号，收好你与物品的故事。|Keep your stories together in one account.
登录|Log in
注册|Sign up
昵称|Display name
你的名字|Your name
邮箱|Email
密码|Password
至少八位字符|At least 8 characters
注册并进入小屋|Sign up and enter
登录并进入小屋|Log in and enter
朋友分享的小屋链接会在登录后自动加入。|A shared room link joins you to your friend's room after login.
我的账号|My account
保存昵称|Save display name
当前密码|Current password
新密码|New password
修改密码|Change password
退出登录|Log out
用户管理|User management
查看注册用户，管理账号状态。|View registered users and manage account status.
正在加载…|Loading…
管理员|Administrator
普通用户|Member
已停用|Disabled
正常|Active
恢复账号|Enable account
停用账号|Disable account
账号状态已更新|Account status updated
请输入昵称|Enter a display name
昵称已更新|Display name updated
密码已更新|Password updated
请输入有效邮箱|Enter a valid email address
邮箱或密码不正确|Incorrect email or password
此邮箱已注册，请登录|This email is already registered. Please log in.
密码至少需要八位|Use a password with at least 8 characters
该账号已停用，请联系管理员|This account is disabled. Please contact the administrator.
当前密码不正确|Incorrect current password
操作太频繁，请稍后重试|Too many attempts. Please try again later.
操作未完成，请检查输入后重试|Unable to complete this action. Please check your details and try again.
账号登录 · 共享记忆|Signed in · shared memories
朋友注册或登录后，可以通过此链接加入小屋，再回应被标注的故事。|Your friend can sign up or log in through this link to join the room and reply to tagged memories.
每一件日常，都值得被记住。|Every everyday thing deserves a story.
你还不是这个小屋的成员|You are not a member of this room.
请先登录|Please log in first.
像素伙伴（自动抠图转化）|Pixel sprite (auto-converted)
像素卡片（保留背景转化）|Pixel card (with backdrop)
原始照片|Original photo
图片显示方式|Photo style
已自动生成像素小精灵（规则算法转化 · 原图仍会保留）|Converted to a pixel sprite (algorithmic · original photo is kept)
原图对比|Original
像素效果|Pixel sprite
正在转化像素形象…|Converting to pixel style…
像素形象文件无效，请重新选择图片|Invalid pixel sprite image. Please choose the photo again.
保留原始照片展示|Showing the original photo
话题原文：|Original topic: 
话题原文|Original topic
记忆原文|Original memory
正在同步剧场语言…|Synchronizing scene language…
重试语言同步|Retry language sync
当前暂时无法同步这场剧场的语言，请稍后重试|Unable to synchronize the scene language right now. Please try again later.
剧场或记忆已变化，请查看最新内容|The scene or its memories changed. Please review the latest version.
请稍后再同步剧场语言|Please wait a moment before synchronizing the scene language again.
请选择中文或英文|Please choose Chinese or English.
记忆原文|Original memory
话题原文|Topic (original)
正在同步剧场语言…|Synchronizing scene language…
重试语言同步|Retry language sync
剧场台词会随语言切换，记忆原文保留不变。|Dialogue follows your selected language. Original records stay unchanged.
像素转换暂时失败，请重新选择图片，或选择原始照片保存。|Pixel conversion could not finish. Choose the image again, or select Original photo to save.
小屋的声音|Room sounds
给小屋一点轻轻的声音。|A little sound for your little room.
午后的小屋|An Afternoon at Home
木琴、拨弦和一点点笛声。|Soft mallets, plucked strings, and a little flute.
背景音乐|Background music
在小屋里，慢慢听。|A gentle tune while you spend time here.
点击音效|Click sounds
点一点，也有小回应。|A little reply to every tap.
总音量|Volume
试听提示音|Try a sound
完成|Done
音乐播放中|Music is playing
点一下，听听小屋|Tap to hear your room
声音设置|Sound settings
这个浏览器暂时无法播放声音。|Sound is unavailable in this browser.
声音还没接上，点一下再试试。|Sound has not started yet. Tap to try again.
现在很安静。|A quiet moment.
点一下页面，音乐就会响起。|Tap anywhere to start the music.
回到小屋后继续播放。|The music will continue when you return.
正在播放：午后的小屋|Now playing: An Afternoon at Home
只保留点击声。|Only click sounds are on.
多选伙伴|Select companions
完成选择|Done selecting
清除选择|Clear selection
一起开剧场|Start a scene together
点选卡片，最多三位；完成选择后可继续查看记忆。|Select up to three cards. Finish selecting to view memories again.
已选剧场伙伴|Selected scene companions
取消选择：|Remove from selection: 
选择参加剧场：|Choose for the scene: 
请先选择至少一位伙伴|Choose at least one companion first.
`;
export const dictionary=Object.fromEntries(entries.trim().split('\n').filter(Boolean).map(line=>{const at=line.indexOf('|');return [line.slice(0,at),line.slice(at+1)];}));
const escapeRE=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const pattern=new RegExp(Object.keys(dictionary).sort((a,b)=>b.length-a.length).map(escapeRE).join('|'),'gu');
let language='zh';
try{if(globalThis.localStorage?.getItem('thingamingos-language')==='en')language='en';}catch{}
export function getLanguage(){return language;}
export function locale(){return language==='en'?'en-US':'zh-CN';}
export function setLanguage(value){language=value==='en'?'en':'zh';try{globalThis.localStorage?.setItem('thingamingos-language',language);}catch{}if(typeof document!=='undefined')document.documentElement.lang=locale();return language;}
export function translateStatic(value,lang=language){return lang==='en'?String(value).replace(pattern,key=>dictionary[key]):String(value);}
export const t=translateStatic;
export function ui(parts,...values){return parts.map((part,i)=>translateStatic(part)+(i<values.length?String(values[i]):'')).join('');}
export function translateError(value,lang=language){if(lang!=='en')return value;return dictionary[value]||'This action could not be completed. Please review your entry and try again.';}
setLanguage(language);
