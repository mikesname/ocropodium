//
// Fancy pants parameter tree.
//

var OcrJs = OcrJs || {}
var NT = OcrJs.Nodetree;
var SvgHelper = SvgHelper || new OcrJs.Nodetree.SvgHelper();


NT.AddNodeCommand = OcrJs.UndoCommand.extend({
    init: function(tree, name, type, atpoint, context) {
        this._super("Add Node");
        var self = this;
        this.redo = function() {
            var node = tree.createNode(name, tree._nodetypes[type]);
            tree.registerNode(node);
            node.moveTo(
                atpoint.x - (node.width / 2),
                atpoint.y - (node.height / 2)
            );
        };
        this.undo = function() {
            var node = tree.getNode(name);
            tree.unregisterNode(node);
            tree.deleteNode(node);
        };
    }
});

NT.DeleteNodeCommand = OcrJs.UndoCommand.extend({
    init: function(tree, name) {
        this._super("Delete Node: " + name);
        var data = tree.getNode(name).serialize();
        this.redo = function() {
            var node = tree.getNode(name);
            tree.unregisterNode(node);
            tree.deleteNode(node);
        };
        this.undo = function() {
            var newnode = tree.createNode(name, tree._nodetypes[data.type]);
            newnode.deserialize(data);
            tree.registerNode(newnode);
        };
    },
});

NT.ConnectPlugsCommand = OcrJs.UndoCommand.extend({
    init: function(tree, srcname, dstname) {
        this._super("Connect Plugs");
        //console.assert(dst instanceof NT.InPlug, "Destination is not an input plug.");
        var self = this;
        this.redo = function() {
            var src = tree.getPlug(srcname);
            var dst = tree.getPlug(dstname);
            tree.connectPlugs(src, dst);
        };
        this.undo = function() {
            var dst = tree.getPlug(dstname);
            dst.detach();
        };
    },

});

NT.DetachPlugCommand = OcrJs.UndoCommand.extend({
    init: function(tree, plugname) {
        this._super("Detach Plug");
        var self = this;
        //console.assert(plug.isAttached(), "Plug is not attached.");
        //console.assert(plug instanceof NT.InPlug, "Attempt to detach a non-input plug.");
        var originname = tree.getPlug(plugname).cable().start.name;
        this.redo = function() {
            tree.getPlug(plugname).detach();
        };
        this.undo = function() {
            tree.connectPlugs(tree.getPlug(originname), tree.getPlug(plugname));
        };
    },
});

NT.IgnoreNodeCommand = OcrJs.UndoCommand.extend({
    init: function(tree, nodename) {
        this._super("Ignore Node: " + nodename);
        var self = this;
        this.redo = function() {
            var node = tree.getNode(nodename);
            node.setIgnored(!node.isIgnored());
        };
        this.undo = function() {
            var node = tree.getNode(nodename);
            node.setIgnored(!node.isIgnored());
        };
    },
});
                   
NT.ViewNodeCommand = OcrJs.UndoCommand.extend({
    init: function(tree, nodename) {
        this._super("View Output for Node: " + nodename);
        var self = this;
        this.redo = function() {
            var node = tree.getNode(nodename);
            node.setViewing(!node.isViewing());
        };
        this.undo = function() {
            var node = tree.getNode(nodename);
            node.setViewing(!node.isViewing());
        };
    },
});
                   
NT.SetNodeParameterCommand = OcrJs.UndoCommand.extend({
    init: function(tree, nodename, param, oldvalue, value) {
        this._super("Set Parameter: " + nodename + "." + param); // + " (" + oldvalue + " -> " + value + ")");
        var self = this;
        this.ts = (new Date()).getTime();
        this.node = nodename;
        this.param = param;
        this.value = value;
        this.oldvalue = oldvalue;
        this.redo = function() {
            tree.getNode(nodename).setParameter(param, self.value, false);
        };
        this.undo = function() {
            tree.getNode(nodename).setParameter(param, self.oldvalue, false);
        };
        this.mergeWith = function(other) {
            // only merge numerical values that occur within
            // a certain time-span
            if (self.ts - other.ts > 200) {
                console.log("Not merging, diff", self.ts - other.ts);
                return false;
            }
            self.oldvalue = other.oldvalue;
            return true;
        };
    },
});

NT.SetMultipleNodeParametersCommand = OcrJs.UndoCommand.extend({
    init: function(tree, nodename, paramvals) {
        this._super("Set Multiple Parameters: " + nodename);
        this.ts = (new Date()).getTime();
        this.node = nodename;
        this.paramvals = paramvals;
        var self = this;
        this.redo = function() {
            $.each(self.paramvals, function(param, newold) {
                tree.getNode(nodename).setParameter(param, newold[0], false);
            });
        };
        this.undo = function() {
            $.each(self.paramvals, function(param, newold) {
                tree.getNode(nodename).setParameter(param, newold[1], false);
            });
        };
        this.mergeWith = function(other) {
            // only merge numerical values that occur within
            // a certain time-span
            if (self.ts - other.ts > 200) {
                console.log("Not merging, diff", self.ts - other.ts);
                return false;
            }
            $.each(other.paramvals, function(param, newold) {
                self.paramvals[param][1] = other.paramvals[param][1];
            });
            return true;
        };
    },
});

NT.MoveNodesCommand = OcrJs.UndoCommand.extend({
    init: function(tree, nodes, x, y) {
        this._super("Move Node" + (nodes.length > 1 ? "s" : ""));
        var self = this;
        this.nodes = nodes;
        this.x = x, this.y = y;
        this.redo = function() {
            for (var i in nodes)
                tree.getNode(nodes[i]).moveBy(self.x, self.y);
        },
        this.undo = function() {
            for (var i in nodes)
                tree.getNode(nodes[i]).moveBy(-self.x, -self.y);
        }
        this.mergeWith = function(other) {
            if (self.nodes.join() != other.nodes.join())
                return false;
            self.x += other.x;
            self.y += other.y;
            return true;
        }
    },
});



NT.Tree = OcrJs.Base.extend({
    init: function(parent, cmdstack, options) {
        this._super(parent, options);
        this.parent = parent;

        // shared command stack object
        this._undostack = cmdstack;

        // events
        this._listeners = {
            onUpdateStarted: [],
            registerUploader: [],
            scriptChanged: [],
            scriptLoaded: [],
            scriptCleared: [],
            nodeMoved: [],
            nodeViewing: [],
            nodeFocussed: [],
            clicked: [],
            rightClicked: [],
            ready: [],
        };

        this.svg = null;

        // node tracking data structures
        this._nodes = [];
        this._nodedata = {};
        this._nodetypes = {};
        this._usednames = {};

        // state maintaining instance vars
        this._dragcable = null;
        this._multiselect = false;

        // random constants
        this._minzoom = 0.1;
        this._maxzoom = 7;
        this._plugre = /^(.*?)_(input|output)(\d*)$/;
    },


    startup: function(data) {
        var self = this;
        $.each(data, function(i, nodeinfo) {
            if (!self._nodedata[nodeinfo.stage])
                self._nodedata[nodeinfo.stage] = [];
            self._nodedata[nodeinfo.stage].push(nodeinfo);
            self._nodetypes[nodeinfo.name] = nodeinfo;
        });
        this.populateCanvas();
    },

    getEvalNode: function() {
        for (var i in this._nodes) {
            if (this._nodes[i].isViewing())
                return this._nodes[i].name;
        }
        for (var i in this._nodes) {
            if (this._nodes[i].isFocussed())
                return this._nodes[i].name;
        }
        for (var i in this._nodes) {
            if (this._nodes[i].stage == "recognize")
                return this._nodes[i].name;
        }
        // fall back on the last node in the list
        var last = this._nodes[this._nodes.length - 1];
        if (last)
            return last.name;
    },

    getFocussedNode: function() {
        var focussed = [];
        $.each(this._nodes, function(i, n) {
            if (n.isFocussed())
                focussed.push(n);
        });
        return focussed[0]; // might be null!
    },

    getNode: function(nodename) {
        if (!this._usednames[nodename])
            throw "Unknown node name: " + nodename;
        return this._usednames[nodename];
    },

    getPlug: function(plugname) {
        var match = plugname.match(this._plugre);
        if (!match)
            throw "Invalid plug name: " + plugname;
        var node = this._usednames[match[1]];
        switch (match[2]) {
            case "input":
                return node.input(parseInt(match[3], 10));
            case "output":
                return node.output();
            default:
                throw "Unexpected plug name: " + plugname;
        }
    },

    clearScript: function() {
        var self = this;
        $.each(this._nodes, function(i, n) {
            n.removeNode(true);
        });
        this._usednames = {};
        this._nodes = [];
        this.trigger("scriptCleared");
    },

    resetSize: function() {
        var svg = $(this.parent).find("svg");
        svg
            .attr("width", Math.max($(this.parent).width(), svg.attr("width")))
            .attr("height", Math.max($(this.parent).height(), svg.attr("height")));
    },

    clearErrors: function() {
        $.map(this._nodes, function(n) {
            n.setErrored(false);
        });
    },

    hasNodes: function() {
        return this._nodes.length > 0;
    },

    nodeCount: function() {
        return this._nodes.length;
    },

    selectedNodeCount: function() {
        return this._nodes.filter(function(n) {
            return n.isFocussed();
        }).length;
    },

    setNodeErrored: function(nodename, error) {
        if (this._usednames[nodename])
            this._usednames[nodename].setErrored(true, error);
    },

    newNodeName: function(type) {
        var count = 1;
        var tname = $.trim(type.replace(/^[^\.]+\./, ""));
        var space = type.match(/\d$/) ? "_" : "";
        while (this._usednames[tname + space + count])
            count += 1;
        return tname + space + count;
    },

    isValidNodeName: function(name, original) {
        if (name == original)
            return true;
        if (name == "" || ~name.search(/\s/))
            return false;
        return !Boolean(this._usednames[name]);
    },

    renameNode: function(node, name) {
        this._usednames[name] = this._usednames[node.name];
        delete this._usednames[node.name];
        node.setName(name);
    },

    group: function() {
        return this._group;
    },

    scriptChanged: function(what) {
        console.log("running script");
        this.trigger("scriptChanged", what);
    },

    setupNodeListeners: function(node) {
        var self = this;
        node.addListeners({
            "toggleIgnored.tree": function(ig) {
                self.cmdSetNodeIgnored(node);
            },
            "toggleFocussed.tree": function() {
                self.setNodeFocussed(node);
            },
            "toggleViewing.tree": function() {
                self.setNodeViewing(node);
            },
            "moved.tree": function(dx, dy) {
                var nodes = [];
                if (node.isFocussed()) {
                    self.cmdMoveNodesBy(self._nodes.filter(function(n) {
                        return n.isFocussed();
                    }), dx, dy);
                } else {
                    self.cmdMoveNodesBy([node], dx, dy);
                }
            },
            "deleted.tree": function() {
                console.log("Deleted node:", node.name);
            },
            "clicked.tree": function(event) {
                self.trigger("clicked", event);
            },
            "rightClicked.tree": function(event) {
                self.trigger("rightClicked", event, node);
            },
            "inputAttached.tree": function(plug) {
                self.handlePlug(plug);
            },
            "outputAttached.tree": function(plug) {
                self.handlePlug(plug);
            },
            "plugHoverIn.tree": function(plug) {
                self.handlePlugHover(plug);
            },
            "plugRightClicked.tree": function(plug, event) {
                self.trigger("rightClicked", event, plug);
            },
        });
    },

    teardownNodeListeners: function(node) {
        node.removeListeners(".tree");
    },

    removeDragCable: function() {
        if (this._dragcable) {
            this._dragcable.start.setDefaultState();
            this._dragcable.remove();
            this._dragcable = null;
        }
        $(document).unbind(".dragcable").unbind(".dropcable");
    },

    handlePlug: function(plug) {
        var self = this;
        if (!self._dragcable && plug.isInput() && plug.isAttached()) {
            this.cmdDetachPlug(plug);
            self.startCableDrag(plug);
        } else if (!self._dragcable) {
            self.startCableDrag(plug);
        } else {
            if (self._dragcable.start.wouldAccept(plug)) {
                this._undostack.beginMacro("Connect Plugs");
                if (plug.isInput() && plug.isAttached())
                    this.cmdDetachPlug(plug);
                if (self._dragcable.start.isInput())
                    self.cmdConnectPlugs(plug, self._dragcable.start);
                else
                    self.cmdConnectPlugs(self._dragcable.start, plug);
                this._undostack.endMacro();
            }
            self.removeDragCable();
        }
    },

    handlePlugHover: function(plug) {
        var self = this;
        if (self._dragcable) {
            var other = self._dragcable.start;
            if (plug.wouldAccept(other)) {
                plug.setAcceptingState();
            } else {
                plug.setRejectingState();
            }
        } else {
            plug.setAcceptingState();
        }
    },

    startCableDrag: function(plug) {
        var self = this;
        var cable = new NT.DragCable(plug);
        var point = SvgHelper.denorm(plug.centre(), plug.group(), self.group());
        cable.draw(self.svg, self._cablegroup, point, point);
        this._dragcable = cable;
        plug.setDraggingState();
        $(document).bind("mousemove.dragcable", function(event) {
            var npoint = SvgHelper.denorm(plug.centre(), plug.group(), self.group());
            var nmp = SvgHelper.mouseCoord(self.parent, event);
            cable.update(npoint, self.relativePoint(nmp));
        });
        $(self.parent).bind("click.dropcable", function(event) {
            self.removeDragCable();
        });
    },

    cmdMoveNodesBy: function(nodes, x, y) {
        this._undostack.push(new NT.MoveNodesCommand(this, nodes.map(function(n) {
            return n.name;
        }), x, y));
    },

    cmdDetachPlug: function(plug) {
        this._undostack.push(new NT.DetachPlugCommand(this, plug.name));
    },

    cmdSetNodeParameter: function(node, param, value) {
        var oldval = node.getParameter(param);
        this._undostack.push(new NT.SetNodeParameterCommand(this, node.name, param, oldval, value));
    },

    cmdSetMultipleNodeParameters: function(node, paramvals) {
        var updates = {};
        $.each(paramvals, function(param, newval) {
            var oldval = node.getParameter(param);
            updates[param] = [newval, oldval];
        });
        this._undostack.push(new NT.SetMultipleNodeParametersCommand(this, node.name, updates));
    },

    cmdConnectPlugs: function(src, dst) {
        this._undostack.push(new NT.ConnectPlugsCommand(this, src.name, dst.name));
    },

    cmdSetNodeIgnored: function(node) {
        this._undostack.push(new NT.IgnoreNodeCommand(this, node.name));
    },

    cmdDisconnectNode: function(node) {
        // when we're about to delete a node, clean
        // up its cables
        // check if we've got an input
        var self = this;
        var outplug = node.output();
        this._undostack.beginMacro("Disconnect Node");
        var referencees = self.attachedInputs(outplug);
        for (var i in referencees)
            this.cmdDetachPlug(referencees[i]);
        for (var i in node.inputs()) {
            var input = node.input(i);
            if (input && input.isAttached()) {
                var srcplug = input.cable().start;
                this.cmdDetachPlug(input);
                for (var j in referencees) {
                    self.cmdConnectPlugs(srcplug, referencees[j]);
                }
            }
        }
        this._undostack.endMacro();
    },

    cmdReplaceNode: function(src, dst) {
        var srcpos = src.position(),
            dstpos = dst.position();

        this._undostack.beginMacro("Replace Node");
        // get all the nodes which connect to this node's inputs
        // and detach them
        var outs = [];
        for (var i in src.inputs()) {
            if (src.input(i).isAttached()) {
                outs.push(src.input(i).cable().start);
                this.cmdDetachPlug(src.input(i));
            }
        }
        // Get all the nodes which connect to it's outputs
        // and detach them
        var ins = this.attachedInputs(src.output());
        for (var i in ins)
            this.cmdDetachPlug(ins[i]);
        // src node is now  fully detached, hopefully
        // connect all the outputs to the dst input
        // and the inputs to the dst output
        for (var i in outs)
            if (dst.input(i))
                this.cmdConnectPlugs(outs[i], dst.input(i));
        for (var i in ins)
            this.cmdConnectPlugs(dst.output(), ins[i]);
        dst.setViewing(src.isViewing());
        dst.setFocussed(src.isFocussed());
        this.cmdMoveNodesBy([dst], srcpos.x - dstpos.x, srcpos.y - dstpos.y);
        this._undostack.push(new NT.DeleteNodeCommand(this, src.name));
        this._undostack.endMacro();
    },

    cmdDeleteSelected: function() {
        var self = this;
        // have to watch out we don't barf the _nodes index
        var togo = [];
        for (var i in this._nodes) {
            if (this._nodes[i].isFocussed())
                togo.push(this._nodes[i]);
        }
        var togo = $.map(this._nodes, function(n) {
            if (n.isFocussed()) return n;
        });
        var multi = togo.length > 1;
        this._undostack.beginMacro("Delete Selection");
        $.map(togo, function(n) {
            self.cmdDisconnectNode(n);
            self._undostack.push(new NT.DeleteNodeCommand(self, n.name));
        });
        this._undostack.endMacro();
    },

    cmdDeleteNode: function(node) {
        this._undostack.beginMacro("Delete " + node.name);
        this.cmdDisconnectNode(node);
        this._undostack.push(new NT.DeleteNodeCommand(this, node.name));
        this._undostack.endMacro();
    },

    cmdCreateReplacementNode: function(type, replace, atpoint) {
        var name = this.newNodeName(type);
        this._undostack.beginMacro("Create Node");
        this._undostack.push(
                new NT.AddNodeCommand(this, name, type, atpoint));
        var node = this.getNode(name);
        this.cmdReplaceNode(replace, node);
        this._undostack.endMacro();
    },

    cmdCreateNode: function(name, type, atpoint) {
        this._undostack.push(new NT.AddNodeCommand(this, name, type, atpoint));
    },

    cmdLayoutNodes: function(data) {
        var self = this;
        console.log("Laying out", data);
        var height = this.svg._height();
        this._undostack.beginMacro("Layout Nodes");
        $.each(data, function(name, value) {
            console.log("Laying out", name, value);
            var node = self.getNode(name);
            var pos = node.position();
            self.cmdMoveNodesBy(
                [node],
                value[0] - pos.x,
                ((height - value[1]) - 100) - pos.y
            );
        });
        this._undostack.endMacro();
        this.centreTree();
    },

    createNodeWithContextFromEvent: function(type, event, context) {
        var atpoint = SvgHelper.mouseCoord(this.parent, event);
        this.createNodeWithContext(type, atpoint, context);
    },

    createNodeWithContext: function(type, atpoint, context) {
        var self = this;
        var name = this.newNodeName(type);

        if (context instanceof NT.Node)
            return this.cmdCreateReplacementNode(type, context, atpoint);

        // otherwise, create a temporary node and defer the
        // actual creation until it is "dropped" somewhere
        // on the canvas.
        var node = this.createNode(name, this._nodetypes[type]);
        var point = this.relativePoint(atpoint);
        node.moveTo(
                point.x - (node.width / 2),
                point.y - (node.height / 2)
        );
        var plug = null,
            cable = null,
            cpoint1 = null;
        if (context instanceof NT.BasePlug && node.arity > 0) {
            cable = new NT.DragCable(context);
            plug = (context instanceof NT.OutPlug) ? node.input(0) : node.output();
            cpoint1 = SvgHelper.denorm(context.centre(), context.group(), this.group());
            var cpoint2 = SvgHelper.denorm(plug.centre(), plug.group(), this.group());
            cable.draw(this.svg, this._cablegroup, cpoint1, cpoint2);
        }

        var removeDragProxies = function(n) {
            n.removeListeners("clicked.dropnode");
            self.deleteNode(n);
            if (plug && cable)
                cable.remove();
        };

        var doNodeCreation = function(atpoint) {
            self._undostack.beginMacro("Create Node");
            self.cmdCreateNode(name, type, atpoint);
            if (plug && cable) {
                if (plug instanceof NT.InPlug)
                    self.cmdConnectPlugs(context, plug);
                else
                    self.cmdConnectPlugs(plug, context);
            }
            self.deselectAll();
            self.getNode(name).setFocussed(true);
            self._undostack.endMacro();
        };

        $(document).bind("keydown.dropnode", function(event) {
            var p = node.position();
            if (event.which == KC_ESCAPE || event.which == KC_RETURN) {
                $(self.parent).add(document).unbind(".dropnode");
                removeDragProxies(node);
            }
            if (event.which == KC_RETURN) {
                doNodeCreation({
                    x: p.x + (node.width / 2),
                    y: p.y + (node.height / 2),
                });
            }
        });
        $(this.parent).bind("mousemove.dropnode", function(event) {
            var nmp = SvgHelper.mouseCoord(self.parent, event);
            var npoint = self.relativePoint(nmp);
            if (plug) {
                var cpoint2 = SvgHelper.denorm(plug.centre(), plug.group(), self.group());
                cable.update(cpoint1, cpoint2);
            }
            node.moveTo(npoint.x - (node.width / 2), npoint.y - (node.height / 2));
        });
        node.addListener("clicked.dropnode", function(event) {
            $(self.parent).add(document).unbind(".dropnode");
            var p = self.relativePoint(SvgHelper.mouseCoord(self.parent, event));
            removeDragProxies(this);
            doNodeCreation(p);
        });
    },

    connectPlugs: function(src, dst) {
        var self = this;
        var cable = new NT.Cable(src, dst);
        var p1 = SvgHelper.denorm(src.centre(), src.group(), this.group());
        var p2 = SvgHelper.denorm(dst.centre(), dst.group(), this.group());
        src.addListener("moved", function() {
            var m1 = SvgHelper.denorm(src.centre(), src.group(), self.group());
            var m2 = SvgHelper.denorm(dst.centre(), dst.group(), self.group());
            cable.update(m1, m2);
        });
        dst.addListener("moved", function() {
            var m1 = SvgHelper.denorm(src.centre(), src.group(), self.group());
            var m2 = SvgHelper.denorm(dst.centre(), dst.group(), self.group());
            cable.update(m1, m2);
        });
        cable.draw(this.svg, this._cablegroup, p1, p2);
    },

    attachedInputs: function(outplug) {
        // since output plugs have no knowledge of what's
        // attached to them we have to search all the nodes
        // to find any that reference a given output.
        var inplugs = [];
        $.each(this._nodes, function(ni, node) {
            $.each(node.inputs(), function(i, input) {
                if (input.isAttached() && input.cable().start == outplug)
                    inplugs.push(input);
            });
        });
        return inplugs;
    },

    setupEvents: function() {
        var self = this;
        $(self.parent).noContext().rightClick(function(event) {
            self.trigger("rightClicked", event, null);
        });

        // enable clicking on the canvas to deselect nodes
        $(this.parent).unbind("mousedown.deselectall")
                .bind("mousedown.deselectall", function(event) {
            if (event.button == 0 && !event.shiftKey) {
                self.deselectAll();
                event.stopPropagation();
                event.preventDefault();
            }
        });
        // zoom with "="(+), and "-" keys...
        function nodeCmd(event) {
            if (event.which == 61 || event.which == 45) {
                self.keyZoom(event.which == 61 ? 1.5 : 0.75);
            }
        }
        // ... and with mouse wheel
        $(self.parent).bind("mousewheel.zoomcanvas", function(event, delta) {
            self.mouseZoom(event, delta);
        });
        // when the canvas is dragged and shift is down, pan the canvas
        // when shift ISN'T down, drag-select
        $(this.parent).bind("mousedown", function(event) {
            if (event.button == 1 || event.button == 0 && event.shiftKey && event.ctrlKey) {
                self.panContainer(event);
                event.stopPropagation();
                event.preventDefault();
            } else if (event.button == 0) {
                self.lassoSelect(event);
            }
        });
        // enable certain key events only when the mouse is in the parent element
        $(self.parent).bind("mouseenter", function(mvevent) {
            $(document).unbind("keypress.nodecmd").bind("keypress.nodecmd", function(event) {
                nodeCmd(event);
            });
            $(document).unbind("keydown.nodecmd").bind("keydown.nodecmd", function(event) {
                var movediff = event.ctrlKey ? 5 : 20;
                switch(event.which) {
                    case KC_SHIFT:
                        self._multiselect = true;
                        break;
                    case KC_UP:
                        self.cmdMoveNodesBy(self.selectedNodes(), 0, -movediff);
                        break;
                    case KC_DOWN:
                        self.cmdMoveNodesBy(self.selectedNodes(), 0, movediff);
                        break;
                    case KC_LEFT:
                        self.cmdMoveNodesBy(self.selectedNodes(), -movediff, 0);
                        break;
                    case KC_RIGHT:
                        self.cmdMoveNodesBy(self.selectedNodes(), movediff, 0);
                        break;
                    default:
                        // if we get here, return before preventing default
                        return;
                }
                // this should only happen for events we've actually handled
                event.preventDefault();
                event.stopPropagation();
            });
            $(document).unbind("keyup.nodecmd").bind("keyup.nodecmd", function(event) {
                if (event.which == KC_SHIFT)
                   self._multiselect = false;
            });
        });
        $(self.parent).bind("mouseleave", function(mvevent) {
            $(document).unbind(".nodecmd");
            $(document).unbind("mousewheel.zoomcanvas");
            $(document).unbind("mousemove.debug");
        });
    },

    getTreeBounds: function() {
        var l, t, r, b;
        $.each(this._nodes, function(i, node) {
            var trans = SvgHelper.getTranslate(node.group());
            if (i == 0) {
                l = trans.x;
                t = trans.y;
                r = trans.x + node.width;
                b = trans.y + node.height;
            } else {
                l = Math.min(l, trans.x);
                t = Math.min(t, trans.y);
                r = Math.max(r, trans.x + node.width);
                b = Math.max(b, trans.y + node.height);
            }
        });
        return {l: l, t: t, r: r, b: b};
    },

    centreTree: function() {
        // centre the tree in the viewport
        if (!this.hasNodes())
            return;
        var border = 25;
        var tw = $(this.parent).width() - (2 * border),
            th = $(this.parent).height() - (2 * border);

        var ctrans = SvgHelper.getTranslate(this.group());
        var bounds = this.getTreeBounds();

        // now determine what zoom/translate we need to
        // centre l, t, r & b
        var w = (bounds.r - bounds.l), h = (bounds.b - bounds.t);
        var tscalex = tw / w, tscaley = th / h;
        var usedscale = Math.min(1, (Math.min(tscalex, tscaley))).toFixed(2);

        // now determine where to translate the canvas to centre the tree
        var xrealpos = (tw - w * usedscale) / 2;
        var yrealpos = (th - h * usedscale) / 2;
        transx = border + (xrealpos - (bounds.l * usedscale));
        transy = border + (yrealpos - (bounds.t * usedscale));

        SvgHelper.updateScale(this.group(), usedscale, usedscale);
        SvgHelper.updateTranslate(this.group(), transx, transy);
    },

    selectedNodes: function() {
        return this._nodes.filter(function(n) {
            return n.isFocussed();
        });
    },

    deselectAll: function() {
        $.map(this._nodes, function(n) {
            n.setFocussed(false);
        });
        this.trigger("nodeFocussed", null);
        console.log("deselected all");
    },

    selectAll: function() {
        $.map(this._nodes, function(n) {
            n.setFocussed(true);
        });
    },

    setNodeViewing: function(node) {
        if (!node.isViewing()) {
            $.each(this._nodes, function(i, other) {
                if (node != other && other.isViewing())
                    other.setViewing(false);
            });
            node.setViewing(!node.isViewing());
            this.trigger("nodeViewing", node);
        }
    },

    setNodeFocussed: function(node) {
        if (!this._multiselect) {
            $.each(this._nodes, function(i, other) {
                if (node != other && other.isFocussed())
                    other.setFocussed(false);
            });
            node.setFocussed(true);
            this.trigger("nodeFocussed", node);
        } else {
            node.setFocussed(!node.isFocussed());
        }
    },

    populateCanvas: function() {
        var self = this;
        $(this.parent).svg({
            onLoad: function(svg) {
                self.svg = svg;
                self.drawTree();
                self.setupEvents();
                self.trigger("ready");
            },
        });
    },

    loadScript: function(script) {
        var self = this;
        this.resetCanvas();
        var havemeta = false;
        this._scriptmeta = script.__meta;
        delete script["__meta"];
        $.each(script, function(name, node) {
            var typedata = self._nodetypes[node.type];
            var newnode = self.createNode(name, typedata);
            self.registerNode(newnode);
            newnode.setIgnored(node.ignored);
            $.each(node.params, function(i, p) {
                newnode.parameters[i].value = p[1];
            });
            if (node.__meta) {
                havemeta = true;
                newnode.moveTo(node.__meta.x, node.__meta.y);
                newnode.setViewing(node.__meta.viewing);
                newnode.setFocussed(node.__meta.focussed);
            }
        });
        this.connectNodes(script);
        this.trigger("scriptLoaded");
    },

    createNode: function(name, typedata) {
        var id = $.map(this._usednames, function(){return true;}).length;
        var node = new NT.Node(name, typedata, id);
        node.draw(this.svg, this._group, 0, 0);
        return node;
    },

    registerNode: function(node) {
        this.setupNodeListeners(node);
        this._usednames[node.name] = node;
        this._nodes.push(node);
    },

    unregisterNode: function(node) {
        this.teardownNodeListeners(node);
        delete this._usednames[node.name];
        var i = this._nodes.indexOf(node);
        console.assert(i > -1, "Node", node.name, "not found in self._nodes");
        this._nodes.splice(i, 1);
    },

    lassoSelect: function(event) {
        var self = this;
        var trans = SvgHelper.getTranslate(self.group());
        var scale = SvgHelper.getScale(self.group());
        var start = self.relativePoint(
                SvgHelper.mouseCoord(self.parent, event));
        var lasso = null;
        $(document).unbind("mousemove.lasso").bind("mousemove.lasso", function(mevent) {
            var end = self.relativePoint(
                    SvgHelper.mouseCoord(self.parent, mevent));
            var rect = SvgHelper.rectFromPoints(start, end);
            if (!lasso && Math.sqrt(rect.width^2 + rect.height^2) > 5) {
                lasso = self.svg.rect(self.group(), rect.x, rect.y,
                            rect.width, rect.height, 0, 0, {
                        fill: "none",
                        stroke: "#000",
                        strokeWidth: 1 / scale,
                        strokeDashArray: (2 / scale) + "," + (2 / scale),
                });
            }
            if (lasso) {
                self.svg.change(lasso, {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                });
            }
        });
        $(document).unbind("mouseup.lasso").bind("mouseup.lasso", function(uevent) {
            if (lasso) {
                var got = self.lassoNodes($(lasso));
                if (self._multiselect)
                    $.map(got, function(n) { n.setFocussed(true); });
                else {
                    $.each(self._nodes, function(i, n) {
                        n.setFocussed(Boolean(~$.inArray(n, got)));
                    });
                }
                self.svg.remove(lasso);
            }
            $(document).unbind(".lasso");
            event.stopPropagation();
            event.preventDefault();
        });
    },

    lassoNodes: function(lasso) {
        // lasso nodes overlapping the lasso box
        var rect = {};
        $.each(["x", "y", "width", "height"], function(i, v) {
            rect[v] = parseInt($(lasso).attr(v));
        });
        var trans, nodes = [];
        $.each(this._nodes, function(i, node) {
            trans = SvgHelper.getTranslate(node.group());
            if (SvgHelper.rectsOverlap(rect, {
                x: trans.x, y: trans.y, width: node.width, height: node.height,
            })) nodes.push(node);
        });
        console.log("Lassood", nodes.length, "nodes");
        return nodes;
    },

    unfocusAllNodes: function() {
        $.map(this._nodes, function(n) { n.setFocussed(false); });
    },

    relativePoint: function(point) {
        var scale = SvgHelper.getScale(this.group());
        var trans = SvgHelper.getTranslate(this.group());
        return {
            x: (point.x - trans.x) / scale,
            y: (point.y - trans.y) / scale
        };
    },

    deleteNode: function(node, alert) {
        node.removeNode(alert);
    },

    buildScript: function() {
        var script = {};
        $.each(this._nodes, function(i, n) {
            script[n.name] = n.serialize();
        });
        return script;
    },

    getState: function() {
        return {
            x: SvgHelper.getTranslate(this.group()).x,
            y: SvgHelper.getTranslate(this.group()).y,
            scale: SvgHelper.getScale(this.group()),
        };
    },

    loadState: function(state) {
        var x = parseInt(state.x),
            y = parseInt(state.y),
            scale = parseFloat(state.scale);
        SvgHelper.updateTransform(
                this.group(),
                isNaN(x) ? 0 : x,
                isNaN(y) ? 0 : y,
                isNaN(scale) ? 1 : Math.max(0.1, scale)
        );
    },

    drawTree: function() {
        var self = this,
            svg = this.svg;

        this._group = svg.group(null, "canvas");
        this._cablegroup = svg.group(this._group, "cables");
        this.defineGradients();
    },

    connectNodes: function(treenodes) {
        var self = this;
        $.each(treenodes, function(name, node) {
            $.each(node.inputs, function(i, input) {
                console.log("Connecting:", input, name);
                var n1 = self._usednames[input];
                var n2 = self._usednames[name];
                self.connectPlugs(n1.output(), n2.input(i));
            });
        });
    },

    resetCanvas: function() {
        SvgHelper.updateTransform(this.group(), 0, 0, 1);
    },

    panContainer: function(event) {
        var dragstart = {
            x: event.pageX,
            y: event.pageY,
        };
        var self = this;
        var trans = SvgHelper.getTranslate(this.group());
        $(document).bind("mousemove.pancanvas", function(moveevent) {
            SvgHelper.updateTranslate(self.group(),
                trans.x + (moveevent.pageX - dragstart.x),
                trans.y + (moveevent.pageY - dragstart.y)
            );
        });
        $(document).bind("mouseup.pancanvas", function() {
            $(this).unbind(".pancanvas");
            event.stopPropagation();
            event.preventDefault();
        });
    },

    keyZoom: function(factor) {
        var point = {
            x: $(this.parent).width() / 2,
            y: $(this.parent).height() / 2,
        };
        this.zoomAtPoint(point, factor);
    },

    mouseZoom: function(event, delta) {
        // ensure the point under the mouse stays under
        // the mouse when zooming.
        var point = SvgHelper.mouseCoord(this.parent, event);
        var factor = delta < 0 ? 0.75 : 1.5;
        this.zoomAtPoint(point, factor);
    },

    zoomAtPoint: function(point, factor) {
        var scale = SvgHelper.getScale(this.group());
        var trans = SvgHelper.getTranslate(this.group());
        var sx = scale * factor;
        if (sx < this._minzoom || sx > this._maxzoom)
            return false;

        // this appears to be the correct formula for translating
        // the canvas so the point under the mouse stays the same
        // when zoomed...
        var shiftx = (point.x - trans.x) * (1 - factor) + trans.x,
            shifty = (point.y - trans.y) * (1 - factor) + trans.y;
        SvgHelper.updateTransform(this.group(), shiftx, shifty, sx);
    },

    defineGradients: function() {
        var defs = this.svg.defs(this._group);
        this.svg.linearGradient(defs, "NodeGradient",
            [["0%", "#f8f8f8"], ["100%", "#ebebeb"]], "0%", "0%", "0%", "100%");
        this.svg.linearGradient(defs, "FocusGradient",
            [["0%", "#f9fcf7"], ["100%", "#f5f9f0"]], "0%", "0%", "0%", "100%");
        this.svg.linearGradient(defs, "ErrorGradient",
            [["0%", "#fdedef"], ["100%", "#f9d9dc"]], "0%", "0%", "0%", "100%");
        this.svg.linearGradient(defs, "ViewingGradient",
            [["0%", "#a9cae5"], ["100%", "#6ea2cc"]], "0%", "0%", "0%", "100%");
        this.svg.linearGradient(defs, "IgnoreGradient",
            [["0%", "#ffffcf"], ["100%", "#ffffad"]], "0%", "0%", "0%", "100%");
        this.svg.linearGradient(defs, "InPlugGradient",
            [["0%", "#d8d8d8"], ["100%", "#dbdbdb"]], "0%", "0%", "0%", "100%");
        this.svg.linearGradient(defs, "OutPlugGradient",
            [["0%", "#dbdbdb"], ["100%", "#d8d8d8"]], "0%", "0%", "0%", "100%");
        this.svg.linearGradient(defs, "PlugAccept",
            [["0%", "#dbf0ca"], ["100%", "#d3e7c3"]], "0%", "0%", "0%", "100%");
        this.svg.linearGradient(defs, "PlugReject",
            [["0%", "#fdedef"], ["100%", "#f9d9dc"]], "0%", "0%", "0%", "100%");
        this.svg.linearGradient(defs, "PlugDragging",
            [["0%", "#a9cae5"], ["100%", "#6ea2cc"]], "0%", "0%", "0%", "100%");
    },
});
