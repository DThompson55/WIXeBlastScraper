"use strict"
const {divider} = require('uuseCommons')
const { readFile,writeFile } = require('fs/promises');
const parse = require('node-html-parser').parse;
const {getGMail} = require('uuseCommons');
const {richContentToText,
  getGeneratedDescriptionFromArticle,
  getLongDescriptionFromArticle,
  getTextFromArticle,
  newEvent} = require('uuseCommons');
const {
  formatDate, 
  argv, 
  month,  
  doNotUpdate,
  eBlastCMS,   
  happeningsCMS,
  newsLetterCMS} = require('uuseCommons');

const menuKey       = (doNotUpdate?"deveBlast":"eBlast");

const {extractFutureDate,
  getNextSunday} = require('uuseCommons')
const {cleanTitle, normalizeTitle} = require('uuseCommons')
const {findStartingContent} = require('uuseCommons');
const {getArticlesFromHTML,getRCParagraph,getRCText} = require('uuseCommons')
const {updateMenu,
  fetchRecords,
  bulkInsert, 
  bulkUpdate, 
  bulkDelete,
  replace} = require('uuseCommons');
const {append4} = require('uuseCommons')

const timestamp = new Date().toISOString();    // used in Rich Content annotations

const updatedEvents = [];
const newEvents = [];

console.log((doNotUpdate?"NOT UPDATING":"UPDATES ARE ENABLED"))//,doNotUpdate,argv.update)
console.log("eBlast CMS is",eBlastCMS);
console.log("Event CMS is",happeningsCMS);

//
// Start Here
//

const {date,capture} = argv;
const filters = {subject:"eBlast"};

getGMail(filters ,date, capture, (html)=>{
  const root = parse(html);
  const path = findStartingContent(root);
  const articles = getArticlesFromHTML(path);
  const allArticles = getAllArticles(articles);
  const services = getServices(articles);
  const metaAllArticles = getMetaAllArticles(allArticles); //create titles, etc. from articles, but not really eBlast
  const metaEBlast = getMetaEBlast(articles); //create titles, etc. from articles, but not really eBlast
  getEvents()
     .then(events => {

      const serviceDateMap = new Map(events
        .filter(ev => ev.data.date && ev.data.isService === true)// Filter events with dates and isService === true
        .map(ev => [ev.data.date, ev])
        );

      const eventDateMap = new Map();
      // Populate the map
      events
        .filter(ev => ev.data.title && ev.data.date) // Filter events with titles and dates
        .forEach(ev => {
          const normalizedTitle = normalizeTitle(ev.data.title);
          if (!eventDateMap.has(normalizedTitle)) {
            eventDateMap.set(normalizedTitle, []); // Initialize an array if the title is new
          }
          eventDateMap.get(normalizedTitle).push(ev); // Add the event to the array
        });
      //
      // Let's look at things with dates in the title
      //
        metaEBlast.forEach(eBlastArticle => {
        const eTitle = normalizeTitle(eBlastArticle.data.title);
        if (eBlastArticle.data.foundDate == null) return;
        let eBlastArticleDate = new Date(eBlastArticle.data.foundDate);
        let today = new Date();
        
        const eventR = eventDateMap.get(eTitle);
        if (eventR && eventR.length > 1){
          //special handling required
          console.log("Abend - Event has multiple dates",eTitle);
          process.exit(0);
        } else {
        if (eventR) { // but don't move a date to an earlier date
          const event = eventR[0];          
          let evDate = new Date(event.data.date);
          
          today.setHours(0, 0, 0, 0);
          
          if ((eBlastArticleDate>evDate) && (eBlastArticleDate >= today)){
            console.log("Update Event Date",eBlastArticle.data.foundDate,event.data.title,event.data.date,eBlastArticle.data.title);
            event.data.date = eBlastArticle.data.foundDate;
            event.why = "Date change from eBlast"
            const { richcontent, longdescription, generatedDescription } = eBlastArticle.data;
            Object.assign(event.data, { richcontent, longdescription, generatedDescription });            
            updatedEvents.push(event);            
          }
          else {
            console.log("No Event Date change but still",eBlastArticle.data.foundDate,event.data.title,event.data.date,eBlastArticle.data.title);
            event.why = "No Date change from eBlast but still"
            const { richcontent, longdescription, generatedDescription } = eBlastArticle.data;
            Object.assign(event.data, { richcontent, longdescription, generatedDescription });                        
            updatedEvents.push(event);
          }
        }
        else{ 
          if (eBlastArticleDate >= today){
          console.log("New Event",eBlastArticle.data.title,"'"+eBlastArticle.data.foundDate+"'")
          newEvents.push(newEvent(eBlastArticle));
        } else {
          console.log("New Event But Earlier than today",eBlastArticle.data.title,"'"+eBlastArticle.data.foundDate+"'")
        }
        }
      }
      });

      services.forEach(service =>{
        let ev = serviceDateMap.get(service.data.date);
        if (ev){
          service.why = "Updated Service"+service.data.date;
          ['longdescription', 'generatedDescription', 'richcontent', 'title'].forEach(
            key => ev.data[key] = service.data[key]
          );         
          ev.why = "Sunday Service Update" 
//dtt            console.log(JSON.stringify(ev,null,2)); 
          updatedEvents.push(ev);
        } else {
          service.why = "New Service"+service.data.date;
          service.data.isService = true;
          newEvents.push(service)
        }  
      })
      metaEBlast.push(metaAllArticles);
      updatedEvents.forEach(eUpdate =>{console.log(   "update Event  -",eUpdate.data.title,"\t||Why?",eUpdate.why)})
      newEvents.forEach(newEvent=>{console.log(       "New Event - - -",newEvent.data.title,"\t||Why?",newEvent.why)});
      bulkUpdate(happeningsCMS,updatedEvents);
      bulkInsert(happeningsCMS,newEvents);
      bulkDelete(eBlastCMS)
      .then(
       addEBlastToCMS(metaEBlast),
       updateMenu(menuKey,(formatDate(date).substring(5)+" eBlast")),
       updateUpcomingServices(services)
       );
    })
	})

function getServices(richcontentR){

const serviceNodes = [...richcontentR[3]];  // sunday service is on node 3
let serviceDate = null;
let serviceText = "";
let serviceTitle = null;
let processedNodes = [];
let serviceDateText = ""

for (const lines of serviceNodes) {
  for (const line of lines){
  //
  // if line.nodes.length == 0 - it's the end of the service
  //
if (line.nodes.length == 0 ) break; //

let text = line.nodes
  .filter(n => n.textData && n.textData.text) // Ensure nodes have textData.text
  .map(n => n.textData.text)                 // Extract text values
  .join(' ');  

  if (serviceTitle == null) serviceTitle = text.replace(/["']|["']$/g, '').trim().replace(/sunday service:\s*/i, ""); // Case-insensitive & removes extra spaces
  if (extractFutureDate(text)){serviceDate = extractFutureDate(text)}
  
  processedNodes.push(line);
  if (serviceDate) serviceDateText = formatDate(serviceDate);
  if (serviceDate) break; // Exit the loop if futureDate is found
  serviceText += text+"\n";
}}

processedNodes.push(append4)
serviceText +=("\n"+append4.nodes[0].textData.text);

if (!(serviceText.includes("Sunday Service"))){
  console.log("Sunday Service not found");
  stop();
}

var richcontent = {
      nodes: processedNodes,
      documentStyle: {},
      metadata: {
        version: 1,
        createdTimestamp: `${timestamp}`,
        updatedTimestamp: `${timestamp}`
      }}
var retval = [{data:{title:serviceTitle,isService:true,
  longdescription:serviceText,
  date:serviceDateText,
  richcontent, 
  generatedDescription: (serviceText.slice(0,144))
}}];

return retval;

}

function getMetaAllArticles(allArticles){
  allArticles.shift();
  allArticles.shift();

    var data = {};
    data.richcontent = {
      nodes: allArticles,
      documentStyle: {},
      metadata: {
        version: 1,
        createdTimestamp: `${timestamp}`,
        updatedTimestamp: `${timestamp}`
      }}
      data.title = "EBlast";
      data.longdescription = getLongDescriptionFromArticle(data.richcontent.nodes);
      data.generatedDescription = getGeneratedDescriptionFromArticle(data.richcontent.nodes);

      return{data};
}

function getMetaEBlast(articles) {
  let sortOrder = 0;
  const retval = [];
  articles.forEach(subarticle=>{
    subarticle.forEach(article=>{
    const data = {}
          data.title = article[0]?.nodes[0]?.textData?.text?.trim() || null;
          // if (article[0].nodes.length === 2) {
          // console.log("extra title part",title, article[0].nodes[1]);
          // }
          // // Remove the first node used as the title
          // article.shift();
//        }

      // Filter out any text-only nodes to create the content body
        data.richcontent = {nodes:article.filter(obj => obj.type !== "TEXT"),
        documentStyle: {},
        metadata: {
          version: 1,
          createdTimestamp: `${timestamp}`,
          updatedTimestamp: `${timestamp}`
        }};
        sortOrder++;
      // Append additional content and generate descriptions
        data.richcontent.nodes.push(append4);
        data.longdescription = getLongDescriptionFromArticle(data.richcontent.nodes);
        data.generatedDescription = getGeneratedDescriptionFromArticle(data.richcontent.nodes);

      // Extract and format date if found
        let foundDate = extractFutureDate(data.longdescription);
        data.foundDate = foundDate ? (formatDate(foundDate)) : null;

       if (data.title)
         retval.push({data});
      });
  });
    console.log("Number of metaEBlasts",retval.length)
    return retval;
}

//
//
//

async function addEBlastToCMS(content){
  const cmsFormat = content.map(item => ({
    data:{
      title:           item.data.title,
      richcontent:     item.data.richcontent,
      longDescription: item.data.longdescription
    }
  }));

  bulkInsert(eBlastCMS,cmsFormat);
}

async function updateUpcomingServices(services){
  const targetDate = services[0].data.date;
  const body = JSON.parse(JSON.stringify(services[0].data.richcontent));
  body.nodes.forEach(node=>{
    node.replacement = true;    
  })

  //
  // reconfigure the body into something like the original Newsletter format
  //

  const paragraph = getRCParagraph();
  paragraph.nodes.push(body.nodes[3].nodes[0])
  paragraph.nodes.push(getRCText(" - Updated - "))
  paragraph.nodes.push(body.nodes[0].nodes[0])
  body.nodes[1].nodes.forEach(node=>{ paragraph.nodes.push(node)})
  body.nodes[2].nodes.forEach(node=>{ paragraph.nodes.push(node)})
  body.nodes[4].nodes.forEach(node=>{ paragraph.nodes.push(node)})
    // console.log(pretty(body.nodes[4]))
    // stop();
  console.log("looking for",targetDate,"in upcoming services");
    try {
        const fileContent = await readFile('../services.js', 'utf-8');
        let upcomingServices = JSON.parse(fileContent);
        
        // Find the index of the object with the matching date
        const index = upcomingServices.findIndex(service => service.date === targetDate);
        if (index !== -1) {
           Object.assign(paragraph, {
                extractedDate: upcomingServices[index].extractedDate,
                textDate: upcomingServices[index].textDate,
                date: upcomingServices[index].date
            });
            upcomingServices[index] = paragraph; // Replace the object
            console.log("Found matching date for upcoming services");
            let update = [{data:{
              title:           "Sunday Services Schedule",
              richcontent: {
                nodes: upcomingServices,
                documentStyle: {},
                metadata: {
                  version: 1,
                  createdTimestamp: `${timestamp}`,
                  updatedTimestamp: `${timestamp}`
                }} // do not change the long description
            }}];
            replace(newsLetterCMS,update[0]);
            await writeFile(((doNotUpdate)?'../services2.js':'../services.js'), JSON.stringify(upcomingServices,null,2));
      }
    } catch (error) {
        console.error('Error reading file:', error);
    }
}

function getAllArticles(groups){
//
// ConsolidatedArticles will be one long list of RC components
// Representing the entire newsletter, or eBlast or whatever
//
  // articles can get edited by some other routine
  // so it gets built near the end with this call
  //
  var i = 0;
  var j = 0;
  var k = 0;
  const result = [];
  groups.forEach(subGroup =>{
    i++;
    j=0;
    k=0;
    subGroup.forEach(item =>{
      j++;
      k=0;
      item.forEach(thing =>{
      k++;
      console.log(i,j,k,"Type",thing.type,"nodes",thing.nodes[0]?.textData?.text||(thing.nodes) );
      result.push(thing);
    })
    })
    result.push(divider);
  })
  return result;
}



async function getEvents() {
  return fetchRecords(happeningsCMS, 'Event (Happenings)');
}

function pretty(s){return JSON.stringify(s,null,2)}
function stop(){process.exit(0)}