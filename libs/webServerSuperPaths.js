var fs = require('fs');
var os = require('os');
var moment = require('moment')
var request = require('request')
var jsonfile = require("jsonfile")
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
var execSync = require('child_process').execSync;
module.exports = function(s,config,lang,app){
    // Get logs json
    app.all([config.webPaths.supersuperApiPrefix+':auth/logs/:ke',config.webPaths.superApiPrefix+':auth/logs/:ke/:id'], function (req,res){
        req.ret={ok:false};
        s.superAuth(req.params,function(resp){
            req.sql='SELECT * FROM Logs WHERE ke=?';req.ar=['$'];
            if(!req.params.id){
                if(user.details.sub&&user.details.monitors&&user.details.allmonitors!=='1'){
                    try{user.details.monitors=JSON.parse(user.details.monitors);}catch(er){}
                    req.or=[];
                    user.details.monitors.forEach(function(v,n){
                        req.or.push('mid=?');req.ar.push(v)
                    })
                    req.sql+=' AND ('+req.or.join(' OR ')+')'
                }
            }else{
                if(!user.details.sub||user.details.allmonitors!=='0'||user.details.monitors.indexOf(req.params.id)>-1||req.params.id.indexOf('$')>-1){
                    req.sql+=' and mid=?';req.ar.push(req.params.id)
                }else{
                    res.end('[]');
                    return;
                }
            }
            if(req.query.start||req.query.end){
                if(!req.query.startOperator||req.query.startOperator==''){
                    req.query.startOperator='>='
                }
                if(!req.query.endOperator||req.query.endOperator==''){
                    req.query.endOperator='<='
                }
                if(req.query.start && req.query.start !== '' && req.query.end && req.query.end !== ''){
                    req.query.start = s.stringToSqlTime(req.query.start)
                    req.query.end = s.stringToSqlTime(req.query.end)
                    req.sql+=' AND `time` '+req.query.startOperator+' ? AND `time` '+req.query.endOperator+' ?';
                    req.ar.push(req.query.start)
                    req.ar.push(req.query.end)
                }else if(req.query.start && req.query.start !== ''){
                    req.query.start = s.stringToSqlTime(req.query.start)
                    req.sql+=' AND `time` '+req.query.startOperator+' ?';
                    req.ar.push(req.query.start)
                }
            }
            if(!req.query.limit||req.query.limit==''){req.query.limit=50}
            req.sql+=' ORDER BY `time` DESC LIMIT '+req.query.limit+'';
            s.sqlQuery(req.sql,req.ar,function(err,r){
                if(err){
                    err.sql=req.sql;
                    res.end(s.prettyPrint(err));
                    return
                }
                if(!r){r=[]}
                r.forEach(function(v,n){
                    r[n].info=JSON.parse(v.info)
                })
                res.end(s.prettyPrint(r))
            })
        },res,req)
    })
    app.all(config.webPaths.superApiPrefix+':auth/logs/delete', function (req,res){
        s.superAuth(req.params,function(resp){
            s.sqlQuery('DELETE FROM Logs WHERE ke=?',['$'],function(){
                var endData = {
                    ok : true
                }
                res.end(s.prettyPrint(endData))
            })
        },res,req)
    })
    app.all(config.webPaths.superApiPrefix+':auth/system/update', function (req,res){
        s.superAuth(req.params,function(resp){
            s.ffmpegKill()
            s.systemLog('Shinobi ordered to update',{
                by: resp.$user.mail,
                ip: resp.ip
            })
            var updateProcess = spawn('sh',(s.mainDirectory+'/UPDATE.sh').split(' '),{detached: true})
            updateProcess.stderr.on('data',function(data){
                s.systemLog('Update Info',data.toString())
            })
            updateProcess.stdout.on('data',function(data){
                s.systemLog('Update Info',data.toString())
            })
            var endData = {
                ok : true
            }
            res.end(s.prettyPrint(endData))
        },res,req)
    })
    app.all(config.webPaths.superApiPrefix+':auth/system/restart/:script', function (req,res){
        s.superAuth(req.params,function(resp){
            var check = function(x){return req.params.script.indexOf(x)>-1}
            var endData = {
                ok : true
            }
            if(check('system')){
                s.systemLog('Shinobi ordered to restart',{by:resp.$user.mail,ip:resp.ip})
                s.ffmpegKill()
                endData.systemOuput = execSync('pm2 restart '+s.mainDirectory+'/camera.js')
            }
            if(check('cron')){
                s.systemLog('Shinobi CRON ordered to restart',{by:resp.$user.mail,ip:resp.ip})
                endData.cronOuput = execSync('pm2 restart '+s.mainDirectory+'/cron.js')
            }
            if(check('logs')){
                s.systemLog('Flush PM2 Logs',{by:resp.$user.mail,ip:resp.ip})
                endData.logsOuput = execSync('pm2 flush')
            }
            res.end(s.prettyPrint(endData))
        },res,req)
    })
    app.all(config.webPaths.superApiPrefix+':auth/system/configure', function (req,res){
        s.superAuth(req.params,function(resp){
            var endData = {
                ok : true
            }
            var postBody = s.getPostData(req)
            if(!postBody){
                endData.ok = false
                endData.msg = lang.postDataBroken
            }else{
                s.systemLog('conf.json Modified',{
                    by: resp.$user.mail,
                    ip: resp.ip,
                    old:jsonfile.readFileSync(s.location.config)
                })
                jsonfile.writeFile(s.location.config,postBody,{spaces: 2},function(){
                    s.tx({f:'save_configuration'},'$')
                })
            }
            res.end(s.prettyPrint(endData))
        },res,req)
    })
    app.all(config.webPaths.superApiPrefix+':auth/accounts/saveSettings', function (req,res){
        s.superAuth(req.params,function(resp){
            var endData = {
                ok : true
            }
            var form = s.getPostData(req)
            if(form){
                var currentSuperUserList = jsonfile.readFileSync(s.location.super)
                var currentSuperUser = {}
                var currentSuperUserPosition = -1
                //find this user in current list
                currentSuperUserList.forEach(function(user,pos){
                    if(user.mail === resp.$user.mail){
                        currentSuperUser = user
                        currentSuperUserPosition = pos
                    }
                })
                var logDetails = {
                    by : resp.$user.mail,
                    ip : resp.ip
                }
                //check if pass and pass_again match, if not remove password
                if(form.pass !== '' && form.pass === form.pass_again){
                    form.pass = s.createHash(form.pass)
                }else{
                    delete(form.pass)
                }
                //delete pass_again from object
                delete(form.pass_again)
                //set new values
                currentSuperUser = Object.assign(currentSuperUser,form)
                //reset email and log change of email
                if(form.mail !== resp.$user.mail){
                    logDetails.newEmail = form.mail
                    logDetails.oldEmail = resp.$user.mail
                }
                //log this change
                s.systemLog('super.json Modified',logDetails)
                //modify or add account in temporary master list
                if(currentSuperUserList[currentSuperUserPosition]){
                    currentSuperUserList[currentSuperUserPosition] = currentSuperUser
                }else{
                    currentSuperUserList.push(currentSuperUser)
                }
                //update master list in system
                jsonfile.writeFile(s.location.super,currentSuperUserList,{spaces: 2},function(){
                    s.tx({f:'save_preferences'},'$')
                })
            }else{
                endData.ok = false
                endData.msg = lang.postDataBroken
            }
            res.end(s.prettyPrint(endData))
        },res,req)
    })
    app.all(config.webPaths.superApiPrefix+':auth/accounts/registerAdmin', function (req,res){
        s.superAuth(req.params,function(resp){
            var endData = {
                ok : false
            }
            var close = function(){
                res.end(s.prettyPrint(endData))
            }
            var isCallbacking = false
            var form = s.getPostData(req)
            if(form){
                if(form.mail !== '' && form.pass !== ''){
                    if(form.pass === form.password_again){
                        isCallbacking = true
                        s.sqlQuery('SELECT * FROM Users WHERE mail=?',[form.mail],function(err,r) {
                            if(r&&r[0]){
                                //found address already exists
                                endData.msg = lang['Email address is in use.'];
                            }else{
                                endData.ok = true
                                //create new
                                //user id
                                form.uid = s.gid()
                                //check to see if custom key set
                                if(!form.ke||form.ke===''){
                                    form.ke=s.gid()
                                }else{
                                    form.ke = form.ke.replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, '')
                                }
                                try{
                                    form.details = JSON.stringify(form.details)
                                }catch(err){}
                                //write user to db
                                s.sqlQuery(
                                    'INSERT INTO Users (ke,uid,mail,pass,details) VALUES (?,?,?,?,?)',
                                    [
                                        form.ke,
                                        form.uid,
                                        form.mail,
                                        s.createHash(form.pass),
                                        form.details
                                    ]
                                )
                                s.tx({f:'add_account',details:form.details,ke:form.ke,uid:form.uid,mail:form.mail},'$')
                                //init user
                                s.loadGroup(form)
                            }
                            close()
                        })
                    }else{
                        endData.msg = lang["Passwords Don't Match"]
                    }
                }else{
                    endData.msg = lang['Email and Password fields cannot be empty']
                }
            }else{
                endData.msg = lang.postDataBroken
            }
            if(isCallbacking === false)close()
        },res,req)
    })
    app.all(config.webPaths.superApiPrefix+':auth/accounts/editAdmin', function (req,res){
        s.superAuth(req.params,function(resp){
            var endData = {
                ok : false
            }
            var close = function(){
                res.end(s.prettyPrint(endData))
            }
            var data = s.getPostData(req)
            if(data){
                var form = data.form
                var account = data.account
                s.sqlQuery('SELECT * FROM Users WHERE mail=?',[account.mail],function(err,r) {
                    if(r && r[0]){
                        r = r[0]
                        var details = JSON.parse(r.details)
                        if(form.pass && form.pass !== ''){
                           if(form.pass === form.password_again){
                               form.pass = s.createHash(form.pass);
                           }else{
                               endData.msg = lang["Passwords Don't Match"]
                               close()
                               return
                           }
                        }else{
                            delete(form.pass);
                        }
                        delete(form.password_again);
                        d.keys=Object.keys(form);
                        d.set=[];
                        d.values=[];
                        d.keys.forEach(function(v,n){
                            if(d.set==='ke'||d.set==='password_again'||!form[v]){return}
                            d.set.push(v+'=?')
                            if(v === 'details'){
                                form[v] = JSON.stringify(Object.assign(details,JSON.parse(form[v])))
                            }
                            d.values.push(form[v])
                        })
                        d.values.push(account.mail)
                        s.sqlQuery('UPDATE Users SET '+d.set.join(',')+' WHERE mail=?',d.values,function(err,r) {
                            if(err){
                                console.log(err)
                                endData.error = err
                                endData.msg = lang.AccountEditText1
                            }else{
                                endData.ok = true
                                s.tx({f:'edit_account',form:form,ke:account.ke,uid:account.uid},'$')
                                delete(s.group[account.ke].init);
                                s.loadGroupApps(account)
                            }
                            close()
                        })
                    }
                })
            }else{
                endData.msg = lang.postDataBroken
                close()
            }
        },res,req)
    })
    app.all(config.webPaths.superApiPrefix+':auth/accounts/deleteAdmin', function (req,res){
        s.superAuth(req.params,function(resp){
            var endData = {
                ok : false
            }
            var close = function(){
                res.end(s.prettyPrint(endData))
            }
            var data = s.getPostData(req)
            if(data){
                var form = data.form
                var account = data.account
                s.sqlQuery('DELETE FROM Users WHERE uid=? AND ke=? AND mail=?',[account.uid,account.ke,account.mail])
                s.sqlQuery('DELETE FROM API WHERE uid=? AND ke=?',[account.uid,account.ke])
                if(req.body.deleteSubAccounts === '1'){
                    s.sqlQuery('DELETE FROM Users WHERE ke=?',[account.ke])
                }
                if(req.body.deleteMonitors === '1'){
                    s.sqlQuery('SELECT FROM Monitors WHERE ke=?',[account.ke],function(err,monitors){
                        monitors.forEach(function(monitor){
                            s.camera('stop',monitor)
                        })
                        s.sqlQuery('DELETE FROM Monitors WHERE ke=?',[account.ke])
                    })
                }
                if(req.body.deleteVideos === '1'){
                    s.sqlQuery('DELETE FROM Videos WHERE ke=?',[account.ke])
                    fs.unlink(s.dir.videos+account.ke)
                }
                if(req.body.deleteEvents === '1'){
                    s.sqlQuery('DELETE FROM Events WHERE ke=?',[account.ke])
                }
                s.tx({f:'delete_account',ke:account.ke,uid:account.uid,mail:account.mail},'$')
            }else{
                endData.msg = lang.postDataBroken
            }
            close()
        },res,req)
    })
}
