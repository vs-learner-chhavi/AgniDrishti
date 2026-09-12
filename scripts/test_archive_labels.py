import unittest
import pandas as pd
from attach_archive_labels import attach

class ArchiveLabelTests(unittest.TestCase):
    def test_identity_unknown_and_ambiguity(self):
        point=dict(id='A',latitude=20.12345,longitude=77.12345,date='2026-09-10',time='0800',satellite='N20')
        row={**point,'latitude':20.123451,'fire_type':'wildfire','label_confidence':'medium','event_id':'source-A','active_days_30d':4,'hotspot_count_30d':7}
        cases=[([row],'wildfire'),([{**row,'satellite':'N21'}],None),([{**row,'time':'0900'}],None),([row,row],None),([{**row,'fire_type':'unknown'}],'unknown')]
        for rows,expected in cases:
            with self.subTest(expected=expected,rows=len(rows)):
                result=attach({'observations':[point.copy()]},pd.DataFrame(rows))['observations'][0]
                self.assertEqual(result.get('datasetLabel',{}).get('fireType'),expected)
                if expected:self.assertEqual(result['datasetLabel']['activeDays30d'],4)

if __name__=='__main__':unittest.main()
