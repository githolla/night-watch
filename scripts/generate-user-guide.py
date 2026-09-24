"""Reproducible illustrated Night Watch guide; run from the repository root."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
import shutil
OUT=Path('output/pdf/night-watch-user-guide.pdf');OUT.parent.mkdir(parents=True,exist_ok=True)
Path('public/guides').mkdir(parents=True,exist_ok=True)
c=canvas.Canvas(str(OUT),pagesize=(612,792));c.setTitle('Night Watch | A practical field guide');c.setAuthor('Nine-67')
INK='#26231e';MUTED='#746d62';GOLD='#9b773e';PALE='#f5f2ec';LINE='#ded8ce';WHITE='#ffffff';GREEN='#386a58'

def box(x,y,w,h,fill=PALE,stroke=None,r=10):
 c.setFillColor(HexColor(fill));c.setStrokeColor(HexColor(stroke or fill));c.roundRect(x,792-y-h,w,h,r,stroke=bool(stroke),fill=1)
def txt(x,y,t,size=11,color=INK,bold=False):
 c.setFillColor(HexColor(color));c.setFont('Helvetica-Bold' if bold else 'Helvetica',size);c.drawString(x,792-y-size,t)
def para(x,y,t,w=516,size=11,color=INK,leading=16):
 p=Paragraph(t,ParagraphStyle('body',fontName='Helvetica',fontSize=size,leading=leading,textColor=HexColor(color)))
 _,h=p.wrap(w,720);assert y+h<741,(y,h,t[:60]);p.drawOn(c,x,792-y-h);return y+h

def line(x,y,x2,y2,color=LINE):
 c.setStrokeColor(HexColor(color));c.setLineWidth(.8);c.line(x,792-y,x2,792-y2)
def label(x,y,t):txt(x,y,t,9,GOLD,True)
def pill(x,y,t,w=110,dark=False):
 box(x,y,w,26,INK if dark else WHITE,LINE if not dark else None,6);txt(x+10,y+7,t,10,WHITE if dark else INK)
def number(x,y,n):
 box(x,y,26,26,GOLD,r=13);txt(x+8,y+6,str(n),11,WHITE,True)
def header(n,title,deck):
 c.bookmarkPage(f'p{n}');c.addOutlineEntry(title,f'p{n}',level=0)
 label(48,30,'NINE-67  /  NIGHT WATCH');txt(496,30,f'GUIDE  {n:02d}',9,MUTED)
 line(48,53,564,53);txt(48,78,title,28,INK,True);para(48,119,deck,510,12,MUTED,17)
def footer(n):
 line(48,747,564,747);txt(48,760,'Night Watch  /  September 2026',8,MUTED);txt(545,760,f'{n:02d}',9,GOLD,True);c.showPage()
def section(y,title,body):
 txt(48,y,title,14,INK,True);return para(48,y+25,body,516,11,MUTED,16)
def note(y,title,body,h=76):
 box(48,y,516,h);label(64,y+13,title);para(64,y+32,body,484,10.5,MUTED,15)

# 1 / quick start
header(1,'From draft to conversation.','Your field guide to setting up Night Watch, tailoring outreach and sending with confidence.')
box(48,175,516,118,INK);label(68,195,'THE EVERYDAY WORKFLOW')
for x,n,t in [(68,'01','Choose'),(196,'02','Personalize'),(324,'03','Test'),(452,'04','Send')]:
 txt(x,220,n,10,'#caae7b');txt(x,241,t,16,WHITE,True)
txt(48,321,'Your first email, in five moves',17,INK,True)
steps=[('Set up your sender','More > Settings > Email accounts. Connect Gmail and save your identity.'),('Choose a company','Open your list. Read the research and check the selected contact.'),('Choose and edit a version','Compare the three options. Save one, then personalize the message.'),('Send yourself a test','Open it in your inbox. Check the wording, spacing and signature.'),('Send the reviewed email','Confirm the address and use Send email from the list owner’s account.')]
y=359
for i,(title,body) in enumerate(steps,1):
 number(48,y,i);txt(86,y,title,12,INK,True);para(86,y+19,body,470,10,MUTED,14);y+=59
label(48,666,'JUMP TO A SECTION')
for x,y,title,page in [(48,689,'02  Sender setup',2),(228,689,'03  Composer map',3),(414,689,'04  Bulk edits',4),(48,714,'05  Test and send',5),(228,714,'06  Quick reference',6)]:
 txt(x,y,title,10,GOLD,True);c.linkRect('',f'p{page}',(x,792-y-16,x+165,792-y+2),relative=0,thickness=0)
footer(1)

# 2 / ownership
header(2,'Start with the right sender.','Your list, the draft identity and the connected mailbox have different roles. Here is how they fit together.')
label(48,173,'SETUP PATH');box(48,194,516,44);txt(64,207,'More  >  Settings  >  Email accounts',13,INK,True)
y=266
for n,title,body in [(1,'Connect your Gmail','Connect the mailbox you will use to contact prospects. A self-test returns to this same inbox.'),(2,'Set your name and greeting','Check your sender name and the greeting format. The app uses the selected list owner’s sender settings.'),(3,'Upload your signature','Save your HTML signature. The delivered email should retain its images, links and formatting. Verify it in a self-test.')]:
 number(48,y,n);txt(86,y,title,13,INK,True);para(86,y+24,body,475,11,MUTED,16);y+=87
label(48,541,'WHEN YOU VIEW THE OTHER LIST')
box(48,566,248,108);box(308,566,256,108)
txt(64,580,'Josh views Suuchi’s list',12,INK,True);para(64,607,'The draft uses <b>Suuchi’s</b> name and signature. Josh can review it and test it in his own inbox.',215,10.5,MUTED,15)
txt(324,580,'Suuchi sends to a prospect',12,INK,True);para(324,607,'Suuchi signs in and sends from <b>her connected mailbox</b>. Viewing a list does not switch your account.',222,10.5,MUTED,15)
para(48,698,'Both teammates can view both lists. Prospect sends require the list owner’s account.',516,10,GOLD,14)
footer(2)

# 3 / illustrated map
header(3,'Meet your composer.','Choose the message first. Then edit, preview and use the action bar at the bottom.')
label(48,166,'SIMPLIFIED INTERFACE MAP  /  NOT A LIVE SCREENSHOT')
box(48,188,516,344,WHITE,LINE,12)
number(62,202,1);txt(101,207,'Recipient name and company',11,INK,True)
line(62,242,550,242);txt(67,255,'Email',11,GOLD,True);txt(132,255,'LinkedIn',11,MUTED)
number(62,287,2)
for x,t,w in [(101,'Direct Offer',125),(234,'Concrete Idea',139),(381,'Delivery Experience',167)]:pill(x,287,t,w,x==101)
number(62,331,3);pill(101,331,'Edit',63,True);pill(171,331,'Preview',82);txt(384,337,'From Suuchi',10,MUTED);txt(493,337,'More',10,MUTED)
line(62,373,550,373);txt(67,386,'Subject',10,MUTED);txt(132,386,'Your tailored subject',11,INK,True)
txt(67,414,'Hi Louis,',11);txt(67,439,'Your message, written for this person and company.',11,MUTED)
line(62,470,550,470);number(62,487,4);pill(260,487,'Send test to myself',160);pill(431,487,'Send email',116,True)
y=554
for title,body in [('1 / Check who receives it','Verify the selected name and address. An inferred address is not a verified mailbox.'),('2 / Compare three approaches','Direct Offer introduces the offer; Concrete Idea proposes a workflow; Delivery Experience explains how Nine-67 works.'),('3 / Make it yours','A card opens a preview. Use this version saves it; Edit this version opens it for editing. Cancel returns to your saved draft.'),('4 / Test, then send','Preview the copy and signature. Self-test before contacting the prospect. More holds secondary actions.')]:
 txt(48,y,title,10.5,INK,True);para(48,y+17,body,516,9.5,MUTED,13);y+=44
footer(3)

# 4 / bulk edits
header(4,'Change the list deliberately.','Use shared wording where it belongs. Keep each contact’s tailored message where it matters.')
box(48,172,516,80);label(64,184,'SUBJECT  /  IN EDIT MODE');pill(64,210,'Your new subject',330);pill(408,210,'Apply to all',140,True)
para(48,269,'Edit the subject and click <b>Apply to all</b>. That exact subject is applied to the selected list’s unsent drafts. Message bodies stay unchanged.',516,11,MUTED,16)
label(48,333,'OPENING  /  EXPAND “SET AN OPENING FOR ALL EMAILS”')
para(48,357,'Write one opening paragraph and click <b>Apply opening to all</b>. It replaces the first paragraph after each greeting.',516,11,MUTED,16)
for x,title,opening,new in [(48,'BEFORE','Existing opening paragraph.',False),(312,'AFTER','Your new shared opening.',True)]:
 box(x,409,252,155);label(x+16,424,title);txt(x+16,449,'Hi Louis,',11)
 box(x+12,475,228,30,'#eee2c8' if new else WHITE);txt(x+20,483,opening,10,INK,new)
 txt(x+16,523,'Company-specific message + CTA',10,MUTED)
section(589,'What stays protected','Each recipient’s greeting, the rest of their message, sent emails and the other list are preserved. Edited and approved drafts are included if they have not been sent.')
para(48,660,'<b>Before applying:</b> keep a copy if you may want to restore the old wording; there is no bulk Undo. Read the completion count, then spot-check a few companies. Choosing another saved version later replaces that draft’s applied copy.',516,10,MUTED,14)
footer(4)

# 5 / testing
header(5,'Test is not Send.','Use your inbox to check the actual delivered email. Then take the separate action to contact the prospect.')
box(48,173,248,177);box(308,173,256,177)
label(64,190,'SEND TEST TO MYSELF');para(64,220,'<b>Goes only to your inbox.</b><br/><br/>Uses your connected Gmail. Keeps the selected list owner’s draft and signature. Does not contact prospects, add CCs or start follow-ups.',214,11,MUTED,16)
label(324,190,'SEND EMAIL');para(324,220,'<b>Goes to the prospect.</b><br/><br/>Requires the list owner’s account. Review the recipient and send confirmation. The send is recorded for history and follow-up work.',220,11,MUTED,16)
section(379,'Your inbox check','Read the subject, greeting and full message. Confirm the signature image and links appear, the name is right and paragraphs are spaced naturally. When testing another person’s list, the test From header is still your own mailbox.')
section(484,'Your final send check','Confirm the address and its status. Save the version you want, finish your edits and Preview. Click Send email and review the confirmation. If you are viewing the other person’s list, sign in as its owner to contact the prospect.')
section(589,'Sending through LinkedIn','Choose LinkedIn, compare its three messages, then use Open LinkedIn and send there. After actually sending, choose <b>More > Mark as already sent</b> to record it. Copying alone does not record a send.')
para(48,689,'If a test fails, read the error before retrying. The limit is five tests per ten minutes.',516,10,GOLD,14)
footer(5)

# 6 / reference
header(6,'Keep the work moving.','Where to go next, what the results mean, and what to check when something looks wrong.')
label(48,170,'YOUR NAVIGATION SHORTLIST')
rows=[('Follow-ups','Review queued messages, recipients and timing. Automatic sequences stop on a detected reply.'),('People','Check contact roles, addresses and LinkedIn details. Inferred addresses remain unverified candidates.'),('More > History','Review recorded outreach and replies. Check the sent version before following up.'),('More > Results','Compare recorded sends and replies by version. Self-tests are excluded; opens are incomplete signals.')]
y=196
for name,body in rows:
 txt(48,y,name,11,INK,True);para(204,y,body,360,10,MUTED,14);line(48,y+44,564,y+44);y+=57
label(48,446,'IF SOMETHING LOOKS WRONG')
for y,title,body in [(473,'Wrong sender name','Check the selected list and that owner’s saved sender settings.'),(517,'Missing or odd signature','Review the uploaded HTML in Settings, save it and self-test again.'),(561,'Cannot send a prospect email','Check the address, list owner and Gmail connection. Review the displayed error.'),(605,'Unexpected wording','Check the chosen version and saved edits before restoring the recommended draft.')]:
 txt(48,y,title,10.5,INK,True);para(48,y+17,body,516,10,MUTED,14)
box(48,665,516,65,INK);txt(64,678,'Need a guided walkthrough?',12,WHITE,True);txt(64,701,'Use the compass / Tour button in the top bar. Escape closes the tour.',10,'#d5cbb9')
c.linkURL('https://night-watch-snowy.vercel.app/outreach',(48,62,564,127),relative=0,thickness=0)
footer(6)
c.save();shutil.copyfile(OUT,'public/guides/night-watch-user-guide.pdf');print(OUT)
