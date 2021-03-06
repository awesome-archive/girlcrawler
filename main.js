#!/usr/bin/env node

//
// Ericlong233/girlcrawler
//

var async    = require("async"),
    program  = require("commander"),
    request  = require("request"),
    cheerio  = require("cheerio"),
    colors   = require("colors"),
    Progress = require("progress"),
    md5      = require("md5"),
    fs       = require("fs"),
    path     = require("path");

var url    = "http://jandan.net/ooxx",
    dir    = "./jandangirls",
    config = dir + "/.config";

var DEFAULT_THREAD  = 64,
    DEFAULT_FILTER  = "oo > xx",
    BREAK_IMAGE_MD5 = "9a49736345f17e6c90dfe3bcd74dfb5e";

program.version("1.2.1")
       .option("-t, --thread <thread>", "The maximum number of concurrent downloads, default " + DEFAULT_THREAD)
       .option("-f, --filter <filter>", "OO/XX based filter, default \"oo > xx\"")
       .parse(process.argv);

function getPageCount(callback) {
    request(url, (err, response, body) => {
        var $ = cheerio.load(body);
        var pageCount = +$("span.current-comment-page").eq(0).text().replace(/(\[|\])/g, "");
        callback(null, pageCount);
    });
}

function getConfig(pageCount, callback) {
    var thread, filter, start, end = pageCount;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
    if (!fs.existsSync(config)) {
        thread = program.thread || DEFAULT_THREAD;
        filter = program.filter || DEFAULT_FILTER;
        start  = 1;
    } else {
        var data = JSON.parse(fs.readFileSync(config, "utf8"));
        thread = program.thread || data.thread || DEFAULT_THREAD;
        filter = program.filter || data.filter || DEFAULT_FILTER;
        start  = data.lastUpdate || 1;
    }
    callback(null, thread, filter, start, end);
}

function setConfig(thread, filter, i, callback) {
    fs.writeFileSync(config, JSON.stringify({
        thread: thread, filter: filter, lastUpdate: i
    }));
    callback(null);
}

function getPictureInfos(page, filter, callback) {
    request(url + "/page-" + page + "#comments", (err, response, body) => {

        var $ = cheerio.load(body);
        async.waterfall([
            (callback) => {
                var comments = [];
                $("ol.commentlist li").each((i, element) => {
                    comments.push(cheerio.load($(element).html()));
                });
                callback(null, comments);
            },
            (comments, callback) => {
                var pictures = [];
                for (var item of comments) {
                    var id, urls = [], oo, xx;
                    oo = +item("span.tucao-like-container span").text();
                    xx = +item("span.tucao-unlike-container span").text();
                    if (!eval(filter)) continue;
                    id = item("span.tucao-like-container a").attr("data-id");
                    item("a.view_img_link").each((i, element) => {
                        urls.push("http:" + $(element).attr("href"));
                    });
                    if (urls.length > 1) {
                        var j = 1;
                        for (var i of urls) {
                            pictures.push({id: id + "-" + j++, url: i, oo: oo, xx: xx});
                        }
                    } else {
                        pictures.push({id: id, url: urls[0], oo: oo, xx: xx});
                    }
                }
                callback(null, pictures);
            },
        ], (err, result) => {
            callback(err, result);
        });

    });
}

function downloadPics(page, pictures, thread, callback) {

    var breakImage = []
    var bar = new Progress("Downloading page " + page + " [:bar]".blue + " :percent ", {
        total: pictures.length,
        complete: "#",
        incomplete: "-",
        clear: true
    });

    async.mapLimit(pictures, thread, (item, callback) => {
        if (!item.url) return callback();    // fixed a bug in 3483878, page 123
        request({
            url: item.url,
            headers: {
                "Connection":    "keep-alive",
                "Cache-Control": "max-age=0",
                "User-Agent":    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36"
            }
        }, (err, response, body) => {
            bar.tick();
            if (!body || (md5(body) == BREAK_IMAGE_MD5)) {
                breakImage.push(item.id + path.extname(item.url));
            }
            callback();
        }).pipe(fs.createWriteStream(dir + "/" + item.id + path.extname(item.url)));
    }, (err, result) => {
        for (var i of breakImage) {
            fs.unlinkSync(dir + "/" + i);
        }
        callback();
    })

}

// 虽然用了 async 还是有一些 callback hell...
async.waterfall([

    (callback) => getPageCount(callback),
    (pageCount, callback) => getConfig(pageCount, callback),
    (thread, filter, start, end, callback) => {

        console.log();
        console.log("Running crawler with arguments: " + ("thread=" + thread + ", filter=\"" + filter + "\"").cyan.underline);

        // 遍历每一页
        var i = start;
        async.whilst(() => i <= end, (callback) => {
            async.waterfall([
                (callback) => setConfig(thread, filter, i, callback),
                (callback) => getPictureInfos(i, filter, callback),
                (pictures, callback) => downloadPics(i, pictures, thread, callback),
            ], (err, result) => {
                i++;
                callback(err, result);
            });
        }, (err, result) => {
            callback(err, result);
        });

    },

], (err, result) => {
    console.log("** F I N I S H E D ! **\n".rainbow)
});
