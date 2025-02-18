"""
Storage node interfaces.
"""

from __future__ import absolute_import

import os
import re
import io
import codecs
import tempfile
import subprocess as sp
from cStringIO import StringIO
import hashlib

from nodetree import node, writable_node, exceptions

from . import base, util as utilnodes
from .. import stages, types, utils

from PIL import Image
import ocrolib

from ocradmin.projects.models import Project
from eulfedora.util import RequestFailed


class DocMixin(node.Node):
    """Base class for storage input interface."""
    parameters = [
            dict(name="project", value=""),
            dict(name="pid", value=""),
    ]

    def validate(self):
        project_pk = self._params.get("project")
        try:
            pk = int(project_pk)
        except ValueError:
            raise exceptions.ValidationError(
                    "Project primary key not set.", self)
        val = self._params.get("pid")
        if not val.strip():
            raise exceptions.ValidationError("Pid not set", self)
        super(DocMixin, self).validate()


class DocWriter(DocMixin, utilnodes.FileOut):
    """Base class for storage output interface."""    
    stage = stages.OUTPUT
    outtype = type(None)
    parameters = [
            dict(name="project", value=""),
            dict(name="pid", value=""),
            dict(
                name="attribute", value="",
                choices=["binary", "transcript"],
            )
    ]

    def validate(self):
        project_pk = self._params.get("project")
        try:
            pk = int(project_pk)
        except ValueError:
            raise exceptions.ValidationError(
                    "Project primary key not set.", self)
        val = self._params.get("pid")
        if not val.strip():
            raise exceptions.ValidationError("Pid not set", self)

    def process(self, input):
        # TODO: Make robust
        if input is None or not os.environ.get("NODETREE_WRITE_FILEOUT"):
            return input

        project = Project.objects.get(pk=self._params.get("project"))
        storage = project.get_storage()
        doc = storage.get(self._params.get("pid"))
        attr = self._params.get("attribute")

        # FIXME: More memory processing... want to somehow make this
        # more efficient for large files
        # FIXME: This also seems to fail on a semi-random basis when
        # using a Fedora backend.
        #try:
        #    memstream = StringIO()
        #    self.input(0).writer(memstream, input)
        #    memstream.flush()
        #    memstream.seek(0)
        #    storage.set_document_attr_content(doc, attr, memstream)        
        #    mimetype = "image/png" if attr == "binary" else "text/html"
        #    storage.set_document_attr_mimetype(doc, attr, mimetype)        
        #    storage.set_document_attr_label(doc, attr, self.label)        
        #    doc.save()
        #    return input
        #finally:
        #    memstream.close()
        with tempfile.NamedTemporaryFile(delete=False, mode="w") as temp:
            self.input(0).writer(temp, input)
            temp.close()
            mimetype = "image/png" if attr == "binary" else "text/html"
            with open(temp.name, "rb") as rtemp:
                storage.set_document_attr_content(doc, attr, rtemp)
                storage.set_document_attr_mimetype(doc, attr, mimetype)        
                storage.set_document_attr_label(doc, attr, self.label)        
                doc.save()
                os.unlink(temp.name)
                return input


class DocImageFileIn(DocMixin, base.GrayPngWriterMixin):
    """Read an image file from doc storage to grayscale."""
    stage = stages.INPUT
    intypes = []
    outtype = ocrolib.numpy.ndarray

    def process(self):
        # TODO: Make robust
        project = Project.objects.get(pk=self._params.get("project"))
        storage = project.get_storage()
        doc = storage.get(self._params.get("pid"))
        with doc.image_content as handle:
            pil = Image.open(handle)
            return ocrolib.numpy.asarray(pil.convert("L"))


        
        


